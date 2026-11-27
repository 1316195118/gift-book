package api

import (
	"errors"
	"strconv"
	"time"

	"giftbook/internal/update"
)

var (
	errAlreadyLatest = errors.New("已是最新版本")
	errLatestChanged = errors.New("更新包与最新版本不一致，请重新检查")
)

// updateJob 只保存在进程内。更新成功后进程会重启，客户端在等待期间轮询即可；
// 重启完成后页面会重新加载并显示新版本。
type updateJob struct {
	ID         string `json:"id"`
	State      string `json:"state"`
	Current    string `json:"current,omitempty"`
	Version    string `json:"version,omitempty"`
	Tag        string `json:"tag,omitempty"`
	Stage      string `json:"stage,omitempty"`
	Message    string `json:"message,omitempty"`
	Percent    int    `json:"percent"`
	Downloaded int64  `json:"downloaded,omitempty"`
	Total      int64  `json:"total,omitempty"`
	Restart    bool   `json:"restart,omitempty"`
	Error      string `json:"error,omitempty"`
	StartedAt  string `json:"startedAt,omitempty"`
	FinishedAt string `json:"finishedAt,omitempty"`
}

func cloneUpdateJob(job *updateJob) *updateJob {
	if job == nil {
		return nil
	}
	copy := *job
	return &copy
}

func (s *Server) beginUpdateJob(version, tag string) (*updateJob, bool) {
	s.updateJobMu.Lock()
	defer s.updateJobMu.Unlock()
	if s.updateJob != nil && s.updateJob.State == "running" {
		return cloneUpdateJob(s.updateJob), false
	}
	// 更新成功后进程即将重启，短时间内不再接受新的更新任务，避免竞态。
	select {
	case <-s.RestartChannel():
		return nil, false
	default:
	}
	s.updateJob = &updateJob{
		ID:        strconv.FormatInt(time.Now().UnixNano(), 10),
		State:     "running",
		Current:   s.version,
		Version:   version,
		Tag:       tag,
		Stage:     "checking",
		Message:   "正在确认最新版本…",
		Percent:   3,
		StartedAt: time.Now().Format(time.RFC3339),
	}
	return cloneUpdateJob(s.updateJob), true
}

func (s *Server) currentUpdateJob() *updateJob {
	s.updateJobMu.Lock()
	defer s.updateJobMu.Unlock()
	return cloneUpdateJob(s.updateJob)
}

func (s *Server) updateJobProgress(id string, progress update.Progress) {
	s.updateJobMu.Lock()
	defer s.updateJobMu.Unlock()
	if s.updateJob == nil || s.updateJob.ID != id || s.updateJob.State != "running" {
		return
	}
	s.updateJob.Stage = progress.Stage
	s.updateJob.Message = progress.Message
	s.updateJob.Percent = progress.Percent
	s.updateJob.Downloaded = progress.Downloaded
	s.updateJob.Total = progress.Total
}

func (s *Server) updateJobAvailable(id string, available *update.Available) {
	s.updateJobMu.Lock()
	defer s.updateJobMu.Unlock()
	if s.updateJob == nil || s.updateJob.ID != id {
		return
	}
	if available != nil {
		s.updateJob.Current = available.Current
		s.updateJob.Version = available.Version
		s.updateJob.Tag = available.Tag
		s.updateJob.Total = available.Size
	}
}

func (s *Server) finishUpdateJob(id string, result *update.Result, err error) {
	s.updateJobMu.Lock()
	defer s.updateJobMu.Unlock()
	if s.updateJob == nil || s.updateJob.ID != id {
		return
	}
	s.updateJob.FinishedAt = time.Now().Format(time.RFC3339)
	if err != nil {
		s.updateJob.State = "failed"
		s.updateJob.Stage = "failed"
		s.updateJob.Message = "更新失败"
		s.updateJob.Error = err.Error()
		return
	}
	s.updateJob.State = "succeeded"
	s.updateJob.Stage = "complete"
	s.updateJob.Percent = 100
	s.updateJob.Downloaded = s.updateJob.Total
	s.updateJob.Restart = s.autoRestart
	if result != nil && result.Version != "" {
		s.updateJob.Version = result.Version
	}
	if s.autoRestart {
		s.updateJob.Message = "更新已安装，正在重启…"
	} else {
		s.updateJob.Message = "更新已安装，请手动重启程序"
	}
}

func (s *Server) runUpdateJob(id string, mgr *update.Manager, requestedTag string) {
	available, err := mgr.Check()
	if err != nil {
		s.finishUpdateJob(id, nil, err)
		return
	}
	if available == nil {
		s.finishUpdateJob(id, nil, errAlreadyLatest)
		return
	}
	if available.Tag != requestedTag {
		s.finishUpdateJob(id, nil, errLatestChanged)
		return
	}
	s.updateJobAvailable(id, available)
	result, err := mgr.ApplyWithProgress(available, func(progress update.Progress) {
		s.updateJobProgress(id, progress)
	})
	if err != nil {
		s.audit(nil, "更新程序失败", "", err.Error())
		s.finishUpdateJob(id, nil, err)
		return
	}
	s.audit(nil, "更新程序", "", result.Version)
	s.finishUpdateJob(id, result, nil)
	if s.autoRestart {
		go func() {
			time.Sleep(600 * time.Millisecond)
			s.requestRestart()
		}()
	}
}
