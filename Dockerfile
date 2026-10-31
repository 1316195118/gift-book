# 电子礼簿 · 单容器镜像（PHP 8.2 + Apache）
# 不装任何额外系统包，构建只要几秒；UTF-8 由 glibc 的 C.UTF-8 保证。
FROM php:8.2-apache

# rewrite：让 .htaccess 生效（data/ 目录靠它拒绝直接访问）
# headers：让 .htaccess 里的 no-store 头真正下发
RUN a2enmod rewrite headers \
 && sed -ri 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf \
 && printf 'expose_php = Off\n' > /usr/local/etc/php/conf.d/hardening.ini

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

WORKDIR /var/www/html

# 应用本体打进镜像；想改页面就挂载 ./www 覆盖它
COPY . /var/www/html/

# 统一权限：拷贝进来的文件可能是 770 或带 ACL，www-data 会读不到 .htaccess
RUN mkdir -p /var/www/html/data \
 && chown -R root:root /var/www/html \
 && chmod -R a+rX /var/www/html \
 && chown -R www-data:www-data /var/www/html/data \
 && chmod 775 /var/www/html/data \
 && cp /var/www/html/entrypoint.sh /usr/local/bin/gift-book-entrypoint \
 && chmod +x /usr/local/bin/gift-book-entrypoint

EXPOSE 80

# 启动时按 PUID / PGID 对齐属主，再拉起 Apache
# 入口脚本放在 webroot 之外：即使把 ./www 挂到 /var/www/html 也不会失效
ENTRYPOINT ["/usr/local/bin/gift-book-entrypoint"]
