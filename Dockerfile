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

RUN mkdir -p /var/www/html/data \
 && chown -R www-data:www-data /var/www/html/data \
 && chmod 775 /var/www/html/data \
 && chmod +x /var/www/html/entrypoint.sh

EXPOSE 80

# 启动时按 PUID / PGID 对齐属主，再拉起 Apache
ENTRYPOINT ["/var/www/html/entrypoint.sh"]
