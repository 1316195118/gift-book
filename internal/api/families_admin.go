package api

import (
	"errors"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"giftbook/internal/auth"
	"giftbook/internal/store"
)

// ---- GET /api/family/me ----

func (s *Server) handleFamilyMe(w http.ResponseWriter, r *http.Request) {
	family, ok := s.resolveFamily(r)
	if !ok {
		failCode(w, http.StatusUnauthorized, "family_required", "请选择家庭并输入访问码")
		return
	}
	data := family.public()
	// 当前家庭的账簿数，供首页设置卡展示。
	events, _ := s.store.ReadEvents()
	for _, event := range events {
		if familyIDOf(event) == "" {
			if family.ID == store.DefaultFamilyID {
				data.EventCount++
			}
			continue
		}
		if familyIDOf(event) == family.ID {
			data.EventCount++
		}
	}
	// 只有站点管理员能看到「家庭管理」入口。
	data.Admin = s.isSiteAdmin(r)
	if data.Admin {
		data.BackupAlert = s.backupAlert()
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: data})
}

// ---- POST /api/family/login ----

func (s *Server) handleFamilyLogin(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := decodeJSON(w, r, &body); err != nil || body == nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	code := strings.TrimSpace(stringValue(body["accessCode"]))
	familyID := strings.TrimSpace(stringValue(body["familyId"]))
	adminUnlocked := s.adminUnlocked(r)
	families, err := s.store.ReadFamilies()
	if err != nil {
		fail(w, http.StatusInternalServerError, "家庭数据读取失败")
		return
	}

	ip := auth.ThrottleTarget("family", s.auth.ClientIP(r), familyID)
	// 管理员凭据已经通过独立校验；家庭访问码冷却只约束普通家庭成员，
	// 不能把同一设备此前的错误访问码尝试变成管理员进入家庭的阻断。
	if !adminUnlocked && s.auth.ThrottleLocked(ip) {
		retry := s.auth.ThrottleRetryAfter(ip)
		w.Header().Set("Retry-After", strconv.Itoa(auth.RetryAfterSeconds(retry)))
		failCode(w, http.StatusTooManyRequests, "family_locked",
			"访问码错误次数过多，请 "+auth.RetryAfterLabel(retry)+"后再试")
		return
	}

	var target familyInfo
	found := false
	if familyID != "" {
		if rec, ok := families[familyID]; ok {
			target = familyFromRecord(familyID, rec)
			found = !target.Archived
		}
	} else if code != "" {
		// 多个家庭用了同一个访问码时不能「进第一个算数」：
		// 那会把用户带进别人家，看到并改动完全无关的账簿。宁可让前端让用户选一次。
		var matches []familyInfo
		for id, rec := range families {
			candidate := familyFromRecord(id, rec)
			if candidate.Archived || candidate.AccessHash == "" {
				continue
			}
			if familyCodeMatches(candidate, code) {
				matches = append(matches, candidate)
			}
		}
		switch len(matches) {
		case 1:
			target, found = matches[0], true
		case 0:
		default:
			sort.Slice(matches, func(i, j int) bool {
				if matches[i].CreatedAt != matches[j].CreatedAt {
					return matches[i].CreatedAt < matches[j].CreatedAt
				}
				return matches[i].ID < matches[j].ID
			})
			list := make([]familyPublic, 0, len(matches))
			for _, match := range matches {
				list = append(list, match.public())
			}
			writeJSON(w, http.StatusConflict, response{
				Success: false,
				Code:    "family_ambiguous",
				Message: "这个访问码对应多个家庭，请选择要进入的家庭",
				Data:    list,
			})
			return
		}
	}
	// 管理员已经通过站点密码认证时，家庭门上的文字输入不应再被误当成家庭访问码。
	// 单家庭直接进入；多家庭返回列表，让前端明确选择，避免把管理员密码当访问码提交。
	if !found && familyID == "" && adminUnlocked {
		var available []familyInfo
		for id, rec := range families {
			candidate := familyFromRecord(id, rec)
			if !candidate.Archived {
				available = append(available, candidate)
			}
		}
		switch len(available) {
		case 1:
			target, found = available[0], true
		default:
			if len(available) > 1 {
				sort.Slice(available, func(i, j int) bool {
					if available[i].CreatedAt != available[j].CreatedAt {
						return available[i].CreatedAt < available[j].CreatedAt
					}
					return available[i].ID < available[j].ID
				})
				list := make([]familyPublic, 0, len(available))
				for _, match := range available {
					list = append(list, match.public())
				}
				writeJSON(w, http.StatusConflict, response{
					Success: false,
					Code:    "family_ambiguous",
					Message: "请选择要进入的家庭",
					Data:    list,
				})
				return
			}
		}
	}

	if !found || (!adminUnlocked && !familyCodeMatches(target, code)) {
		if code != "" {
			s.auth.ThrottleFail(ip, code)
		}
		failCode(w, http.StatusForbidden, "family_code", "家庭访问码不正确")
		return
	}
	s.auth.ThrottleClear(ip)
	s.setFamilyCookie(w, r, target.ID, target.SessionEpoch)
	writeJSON(w, http.StatusOK, response{Success: true, Data: target.public()})
}

// ---- POST /api/family/logout ----

func (s *Server) handleFamilyLogout(w http.ResponseWriter, r *http.Request) {
	s.clearFamilyCookie(w, r)
	writeJSON(w, http.StatusOK, response{Success: true})
}

// ---- GET /api/families（站点管理员） ----

func (s *Server) handleListFamilies(w http.ResponseWriter, r *http.Request) {
	if !s.isSiteAdmin(r) {
		fail(w, http.StatusForbidden, "只有站点管理员可以管理家庭")
		return
	}
	families, err := s.store.ReadFamilies()
	if err != nil {
		fail(w, http.StatusInternalServerError, "家庭数据读取失败")
		return
	}
	events, _ := s.store.ReadEvents()
	counts := map[string]int{}
	lastActive := map[string]string{}
	for _, event := range events {
		owner := familyIDOf(event)
		if owner == "" {
			owner = store.DefaultFamilyID
		}
		counts[owner]++
		stamp, _ := event["updatedAt"].(string)
		if stamp == "" {
			stamp, _ = event["createdAt"].(string)
		}
		if stamp > lastActive[owner] {
			lastActive[owner] = stamp
		}
	}
	list := make([]familyPublic, 0, len(families))
	for id, rec := range families {
		item := familyFromRecord(id, rec).public()
		item.EventCount = counts[id]
		item.LastActiveAt = lastActive[id]
		list = append(list, item)
	}
	// 同一秒创建的家庭 CreatedAt 相同：用 ID 兜底，保证每次返回顺序稳定。
	sort.Slice(list, func(i, j int) bool {
		if list[i].CreatedAt != list[j].CreatedAt {
			return list[i].CreatedAt < list[j].CreatedAt
		}
		return list[i].ID < list[j].ID
	})
	writeJSON(w, http.StatusOK, response{Success: true, Data: list})
}

// ---- GET /api/families/activity（站点管理员） ----

// 跨家庭的最近账簿：一次看清各家庭最近在记什么，不用来回切换。
func (s *Server) handleFamilyActivity(w http.ResponseWriter, r *http.Request) {
	if !s.isSiteAdmin(r) {
		fail(w, http.StatusForbidden, "只有站点管理员可以查看全部家庭的账簿")
		return
	}
	events, err := s.store.ReadEvents()
	if err != nil {
		fail(w, http.StatusInternalServerError, "账簿读取失败")
		return
	}
	families, err := s.store.ReadFamilies()
	if err != nil {
		fail(w, http.StatusInternalServerError, "家庭清单读取失败")
		return
	}
	names := make(map[string]string, len(families))
	for id, rec := range families {
		name, _ := rec["name"].(string)
		names[id] = name
	}
	type activity struct {
		ID          string  `json:"id"`
		Name        string  `json:"name"`
		FamilyID    string  `json:"familyId"`
		FamilyName  string  `json:"familyName"`
		CreatedAt   string  `json:"createdAt"`
		TotalAmount float64 `json:"totalAmount"`
		GiftCount   int     `json:"giftCount"`
	}
	items := make([]activity, 0, len(events))
	for id, event := range events {
		owner := familyIDOf(event)
		if owner == "" {
			owner = store.DefaultFamilyID
		}
		name, _ := event["name"].(string)
		created, _ := event["createdAt"].(string)
		total, _ := event["totalAmount"].(float64)
		items = append(items, activity{
			ID: id, Name: name, FamilyID: owner, FamilyName: names[owner],
			CreatedAt: created, TotalAmount: total,
		})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt != items[j].CreatedAt {
			return items[i].CreatedAt > items[j].CreatedAt
		}
		return items[i].ID > items[j].ID
	})
	if len(items) > 12 {
		items = items[:12]
	}
	for i := range items {
		items[i].GiftCount = s.store.CountGifts(items[i].ID)
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: items})
}

// ---- POST /api/families/import（站点管理员：把家庭备份导入为新家庭） ----

// 换 NAS / 迁移单个家庭时用：整站备份会覆盖全站，这里只新建一个家庭并写入它的账簿，
// 不影响现有家庭，也不需要知道原家庭的访问码。
func (s *Server) handleImportFamilyBackup(w http.ResponseWriter, r *http.Request) {
	if !s.isSiteAdmin(r) {
		fail(w, http.StatusForbidden, "只有站点管理员可以导入家庭备份")
		return
	}
	parsed, filename, ok := s.readBackupUpload(w, r)
	if !ok {
		return
	}
	if parsed.manifest.Scope != "family" {
		fail(w, http.StatusBadRequest, "请选择「家庭备份」文件；整站备份请到「备份与恢复」里还原")
		return
	}
	name := strings.TrimSpace(r.FormValue("name"))
	if name == "" {
		name = strings.TrimSpace(parsed.manifest.FamilyName)
	}
	if name == "" {
		name = "导入的家庭"
	}
	if len([]rune(name)) > 40 {
		fail(w, http.StatusBadRequest, "家庭名称不能超过 40 个字")
		return
	}
	code := strings.TrimSpace(r.FormValue("accessCode"))
	if problem := familyCodeProblem(code); problem != "" {
		fail(w, http.StatusBadRequest, problem+"；留空则创建开放家庭")
		return
	}
	families, err := s.store.ReadFamilies()
	if err != nil {
		fail(w, http.StatusInternalServerError, "家庭清单读取失败")
		return
	}
	if len(families) >= 1 && !s.auth.Enabled() {
		failCode(w, http.StatusForbidden, "admin_password_required", "开启多家庭前，请先设置管理员密码")
		return
	}
	if s.familyCodeTaken(families, "", code) {
		fail(w, http.StatusConflict, "这个访问码已被其他家庭使用，请换一个")
		return
	}
	id := "fam_" + randomFamilyHex(6)
	rec := store.Record{"id": id, "name": name, "createdAt": time.Now().Format("2006-01-02 15:04:05")}
	if code != "" {
		salt := randomFamilyHex(16)
		rec["accessHash"] = hashFamilyCode(code, salt)
		rec["salt"] = salt
	}
	if err := s.store.WithFamilies(func(items map[string]store.Record) (bool, error) {
		items[id] = rec
		return true, nil
	}); err != nil {
		fail(w, http.StatusInternalServerError, "家庭保存失败")
		return
	}
	// 备份可能来自同一台机器（复制家庭），账簿编号会撞车；撞了就换新编号，
	// 礼金文件跟着新编号走，原家庭完全不受影响。
	existing, _ := s.store.ReadEvents()
	events := make(map[string]store.Record, len(parsed.events))
	gifts := make(map[string]map[string]store.Record, len(parsed.gifts))
	for oldID, event := range parsed.events {
		newID := oldID
		if _, clash := existing[oldID]; clash {
			newID = store.NewID()
		}
		event["id"] = newID
		event["familyId"] = id
		events[newID] = event
		if items, ok := parsed.gifts[oldID]; ok {
			gifts[newID] = items
		}
	}
	if err := s.store.ReplaceFamily(id, events, gifts); err != nil {
		// 导入失败时把刚建的空家庭撤掉，避免留下一个进不去的空壳。
		_ = s.store.WithFamilies(func(items map[string]store.Record) (bool, error) {
			delete(items, id)
			return true, nil
		})
		fail(w, http.StatusInternalServerError, "导入失败："+err.Error())
		return
	}
	s.audit(r, "导入家庭备份", name, filename)
	s.notifyChange(r, "family-restore", "imported", id, "")
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		"familyId": id, "family": name,
		"events": len(events), "gifts": countGifts(gifts),
		"hasCode": code != "", "sourceName": filename,
	}})
}

// ---- POST /api/families（站点管理员） ----

func (s *Server) handleCreateFamily(w http.ResponseWriter, r *http.Request) {
	if !s.isSiteAdmin(r) {
		fail(w, http.StatusForbidden, "只有站点管理员可以管理家庭")
		return
	}
	var body map[string]any
	if err := decodeJSON(w, r, &body); err != nil || body == nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	name := strings.TrimSpace(stringValue(body["name"]))
	code := strings.TrimSpace(stringValue(body["accessCode"]))
	if name == "" || len([]rune(name)) > 40 {
		fail(w, http.StatusBadRequest, "家庭名称不能为空，且不超过 40 个字")
		return
	}
	if problem := familyCodeProblem(code); problem != "" {
		fail(w, http.StatusBadRequest, problem+"；留空则创建开放家庭")
		return
	}
	id := "fam_" + randomFamilyHex(6)
	now := time.Now().Format("2006-01-02 15:04:05")
	rec := store.Record{"id": id, "name": name, "createdAt": now}
	if code != "" {
		salt := randomFamilyHex(16)
		rec["accessHash"] = hashFamilyCode(code, salt)
		rec["salt"] = salt
	}
	var status int
	var errCode, message string
	err := s.store.WithFamilies(func(families map[string]store.Record) (bool, error) {
		// 多家庭模式必须有管理员密码：否则任何家庭成员都能卡住整站备份与管理，
		// 家庭门也没有稳定的管理员入口。第一个家庭（默认家庭）不受影响。
		if len(families) >= 1 && !s.auth.Enabled() {
			status, errCode, message = http.StatusForbidden, "admin_password_required", "开启多家庭前，请先设置管理员密码"
			return false, errors.New(message)
		}
		// 访问码是进入家庭的唯一凭据，重码会让用户被带进别人家，这里直接拒绝。
		if s.familyCodeTaken(families, "", code) {
			status, errCode, message = http.StatusConflict, "family_code_taken", "这个访问码已被其他家庭使用，请换一个"
			return false, errors.New(message)
		}
		families[id] = rec
		return true, nil
	})
	if err != nil {
		if status == 0 {
			status, message = http.StatusInternalServerError, "家庭保存失败"
		}
		failCode(w, status, errCode, message)
		return
	}
	s.audit(r, "创建家庭", name, id)
	writeJSON(w, http.StatusOK, response{Success: true, Data: familyFromRecord(id, rec).public()})
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}

// ---- GET /api/families/open（家庭门用，只返回免访问码家庭） ----

func (s *Server) handleOpenFamilies(w http.ResponseWriter, r *http.Request) {
	families, err := s.store.ReadFamilies()
	if err != nil {
		fail(w, http.StatusInternalServerError, "家庭数据读取失败")
		return
	}
	list := make([]familyPublic, 0)
	for id, rec := range families {
		family := familyFromRecord(id, rec)
		if family.Archived || family.AccessHash != "" {
			continue
		}
		list = append(list, family.public())
	}
	// 同一秒创建的家庭 CreatedAt 相同：用 ID 兜底，保证每次返回顺序稳定。
	sort.Slice(list, func(i, j int) bool {
		if list[i].CreatedAt != list[j].CreatedAt {
			return list[i].CreatedAt < list[j].CreatedAt
		}
		return list[i].ID < list[j].ID
	})
	writeJSON(w, http.StatusOK, response{Success: true, Data: list})
}

// ---- PUT /api/families/{id}（站点管理员：改名 / 重置访问码 / 改为开放家庭） ----

func (s *Server) handleUpdateFamily(w http.ResponseWriter, r *http.Request, id string) {
	currentFamily, _ := s.resolveFamily(r)
	if !s.isSiteAdmin(r) {
		fail(w, http.StatusForbidden, "只有站点管理员可以管理家庭")
		return
	}
	if !eventIDPattern.MatchString(id) {
		fail(w, http.StatusBadRequest, "无效的家庭ID")
		return
	}
	var body map[string]any
	if err := decodeJSON(w, r, &body); err != nil || body == nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	var updated store.Record
	var status int
	var message string
	err := s.store.WithFamilies(func(families map[string]store.Record) (bool, error) {
		rec, ok := families[id]
		if !ok {
			status, message = http.StatusNotFound, "家庭不存在"
			return false, errors.New(message)
		}
		if rawName, exists := body["name"]; exists {
			name := strings.TrimSpace(stringValue(rawName))
			if name == "" || len([]rune(name)) > 40 {
				status, message = http.StatusBadRequest, "家庭名称不能为空，且不超过 40 个字"
				return false, errors.New(message)
			}
			rec["name"] = name
		}
		if rawCode, exists := body["accessCode"]; exists {
			code := strings.TrimSpace(stringValue(rawCode))
			if code == "" {
				// 留空 = 改为开放家庭：清掉旧码，任何人可从此家庭的入口进入。
				delete(rec, "accessHash")
				delete(rec, "salt")
			} else {
				if problem := familyCodeProblem(code); problem != "" {
					status, message = http.StatusBadRequest, problem
					return false, errors.New(message)
				}
				if s.familyCodeTaken(families, id, code) {
					status, message = http.StatusConflict, "这个访问码已被其他家庭使用，请换一个"
					return false, errors.New(message)
				}
				salt := randomFamilyHex(16)
				rec["accessHash"] = hashFamilyCode(code, salt)
				rec["salt"] = salt
			}
			// 改码或改为开放家庭后，旧设备上的家庭 Cookie 立即失效。
			bumpFamilyEpoch(rec)
		}
		rec["updatedAt"] = time.Now().Format("2006-01-02 15:04:05")
		families[id] = rec
		updated = rec
		return true, nil
	})
	if err != nil {
		if status == 0 {
			status, message = http.StatusInternalServerError, "家庭保存失败"
		}
		fail(w, status, message)
		return
	}
	updatedFamily := familyFromRecord(id, updated)
	// 改的是当前正在用的家庭：给操作者换发新 Cookie，避免自己也掉线。
	if currentFamily.ID == id {
		s.setFamilyCookie(w, r, id, updatedFamily.SessionEpoch)
	}
	detail := "改名或更新访问码"
	if _, changed := body["accessCode"]; changed {
		detail = "访问码变更，旧设备已失效"
	}
	s.audit(r, "修改家庭", updatedFamily.Name, detail)
	writeJSON(w, http.StatusOK, response{Success: true, Data: updatedFamily.public()})
}

// ---- DELETE /api/families/{id} ----

// 删除家庭：管理员登录 + 二次输入管理员密码 + 家庭名称确认。
// 账簿与礼金先移入 .trash/family-*，不做物理删除。
func (s *Server) handleDeleteFamily(w http.ResponseWriter, r *http.Request, id string) {
	if !s.isSiteAdmin(r) {
		fail(w, http.StatusForbidden, "只有站点管理员可以删除家庭")
		return
	}
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		ConfirmName     string `json:"confirmName"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	if !s.auth.Enabled() {
		failCode(w, http.StatusForbidden, "admin_password_required", "请先在「设置 → 管理员密码」里设置密码，再删除家庭")
		return
	}
	if strings.TrimSpace(body.CurrentPassword) == "" {
		fail(w, http.StatusBadRequest, "请输入管理员密码")
		return
	}
	families, err := s.store.ReadFamilies()
	if err != nil {
		fail(w, http.StatusInternalServerError, "家庭数据读取失败")
		return
	}
	rec, exists := families[id]
	if !exists {
		fail(w, http.StatusNotFound, "家庭不存在")
		return
	}
	family := familyFromRecord(id, rec)
	if family.ID == store.DefaultFamilyID {
		fail(w, http.StatusBadRequest, "默认家庭不能删除")
		return
	}
	if strings.TrimSpace(body.ConfirmName) != family.Name {
		fail(w, http.StatusBadRequest, "请输入完整的家庭名称以确认删除")
		return
	}
	ok, fails, retry := s.auth.VerifyOrFail(r, body.CurrentPassword)
	if !ok {
		if retry > 0 {
			w.Header().Set("Retry-After", itoa(auth.RetryAfterSeconds(retry)))
			fail(w, http.StatusTooManyRequests, "尝试次数过多，请 "+auth.RetryAfterLabel(retry)+"后再试")
			return
		}
		left := 5 - fails
		if left < 1 {
			left = 1
		}
		fail(w, http.StatusUnauthorized, "管理员密码不正确，还可尝试 "+itoa(left)+" 次")
		return
	}

	archived, trashName, err := s.store.ArchiveFamily(family.ID, family.Name)
	if err != nil {
		fail(w, http.StatusInternalServerError, "家庭账簿归档失败："+err.Error())
		return
	}
	err = s.store.WithFamilies(func(current map[string]store.Record) (bool, error) {
		if _, still := current[id]; !still {
			return false, errors.New("家庭不存在")
		}
		delete(current, id)
		return true, nil
	})
	if err != nil {
		fail(w, http.StatusInternalServerError, "账簿已归档，但家庭记录删除失败，请重试")
		return
	}
	// 家庭记录删掉之后才搬自动备份：这一步失败也只是留下一个孤儿目录，
	// 不会出现「备份进归档了、家庭还在」的中间状态。
	backupArchive := s.archiveFamilyBackups(family.ID, trashName)
	log.Printf("已删除家庭 %s（%s），归档 %d 本账簿到 .trash/%s", family.Name, family.ID, archived, trashName)
	parts := []string{"该家庭没有账簿"}
	if trashName != "" {
		parts = []string{"归档 " + itoa(archived) + " 本账簿到 .trash/" + trashName}
	}
	if backupArchive != "" {
		parts = append(parts, "自动备份已一并归档")
	}
	s.audit(r, "删除家庭", family.Name, strings.Join(parts, "；"))
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		"id":      family.ID,
		"name":    family.Name,
		"events":  archived,
		"archive": trashName,
		"backups": backupArchive != "",
	}})
}

// ---- PUT /api/family/self（家庭成员：改名 / 换访问码 / 改为开放家庭） ----

func (s *Server) handleFamilySelfUpdate(w http.ResponseWriter, r *http.Request) {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	var body struct {
		Name        *string `json:"name"`
		CurrentCode *string `json:"currentCode"`
		NewCode     *string `json:"newCode"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	if body.Name == nil && body.NewCode == nil {
		fail(w, http.StatusBadRequest, "没有要修改的内容")
		return
	}
	var status int
	var message string
	var updated store.Record
	err := s.store.WithFamilies(func(families map[string]store.Record) (bool, error) {
		rec, exists := families[family.ID]
		if !exists {
			status, message = http.StatusNotFound, "家庭不存在"
			return false, errors.New(message)
		}
		if body.Name != nil {
			name := strings.TrimSpace(*body.Name)
			if name == "" || len([]rune(name)) > 40 {
				status, message = http.StatusBadRequest, "家庭名称不能为空，且不超过 40 个字"
				return false, errors.New(message)
			}
			rec["name"] = name
		}
		if body.NewCode != nil {
			newCode := strings.TrimSpace(*body.NewCode)
			if problem := familyCodeProblem(newCode); problem != "" {
				status, message = http.StatusBadRequest, problem+"；留空则改为开放家庭"
				return false, errors.New(message)
			}
			// 改码是敏感操作：有码家庭必须再输一次当前访问码；
			// 开放家庭没有可验证的凭据，只能由站点管理员设置。
			if family.AccessHash != "" {
				current := ""
				if body.CurrentCode != nil {
					current = strings.TrimSpace(*body.CurrentCode)
				}
				if !familyCodeMatches(family, current) {
					status, message = http.StatusForbidden, "当前家庭访问码不正确"
					return false, errors.New(message)
				}
			} else if !s.isSiteAdmin(r) {
				status, message = http.StatusForbidden, "开放家庭设置访问码需要站点管理员操作"
				return false, errors.New(message)
			}
			if newCode == "" {
				delete(rec, "accessHash")
				delete(rec, "salt")
			} else {
				if s.familyCodeTaken(families, family.ID, newCode) {
					status, message = http.StatusConflict, "这个访问码已被其他家庭使用，请换一个"
					return false, errors.New(message)
				}
				salt := randomFamilyHex(16)
				rec["accessHash"] = hashFamilyCode(newCode, salt)
				rec["salt"] = salt
			}
			bumpFamilyEpoch(rec)
		}
		rec["updatedAt"] = time.Now().Format("2006-01-02 15:04:05")
		families[family.ID] = rec
		updated = rec
		return true, nil
	})
	if err != nil {
		if status == 0 {
			status, message = http.StatusInternalServerError, "家庭保存失败"
		}
		fail(w, status, message)
		return
	}
	result := familyFromRecord(family.ID, updated)
	// 换码后当前设备继续可用：换发带新 epoch 的 Cookie。
	s.setFamilyCookie(w, r, family.ID, result.SessionEpoch)
	detail := "家庭自助改名"
	if body.NewCode != nil {
		detail = "家庭自助修改访问码，旧设备已失效"
	}
	s.audit(r, "家庭自助设置", result.Name, detail)
	writeJSON(w, http.StatusOK, response{Success: true, Data: result.public()})
}

// ---- POST /api/families/{id}/logout-all（站点管理员：让该家庭所有设备重新验证） ----

func (s *Server) handleFamilyLogoutAll(w http.ResponseWriter, r *http.Request, id string) {
	if !s.isSiteAdmin(r) {
		fail(w, http.StatusForbidden, "只有站点管理员可以管理家庭")
		return
	}
	var updated store.Record
	var status int
	var message string
	err := s.store.WithFamilies(func(families map[string]store.Record) (bool, error) {
		rec, exists := families[id]
		if !exists {
			status, message = http.StatusNotFound, "家庭不存在"
			return false, errors.New(message)
		}
		bumpFamilyEpoch(rec)
		rec["updatedAt"] = time.Now().Format("2006-01-02 15:04:05")
		families[id] = rec
		updated = rec
		return true, nil
	})
	if err != nil {
		if status == 0 {
			status, message = http.StatusInternalServerError, "家庭保存失败"
		}
		fail(w, status, message)
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: familyFromRecord(id, updated).public()})
}

func updatedFamilyName(rec store.Record) string {
	name, _ := rec["name"].(string)
	return name
}
