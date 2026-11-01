# 电子礼簿 · 单容器镜像（PHP 8.2 + Apache）
# 网页文件都在 www/ 里，构建时整体拷进 /var/www/html
# 不装任何额外系统包，构建只要几秒；UTF-8 由 glibc 的 C.UTF-8 保证。
FROM php:8.2-apache

# rewrite：让 .htaccess 生效（data/、config/ 目录靠它拒绝直接访问）
# headers / expires / deflate：静态资源缓存 + 压缩，页面加载更快
RUN a2enmod rewrite headers expires deflate \
 && sed -ri 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf \
 && printf 'expose_php = Off\nServerTokens Prod\nServerSignature Off\n' > /usr/local/etc/php/conf.d/hardening.ini \
 && printf 'opcache.enable=1\nopcache.memory_consumption=64\nopcache.interned_strings_buffer=8\nopcache.max_accelerated_files=10000\nopcache.validate_timestamps=1\nopcache.revalidate_freq=2\nrealpath_cache_size=4096K\nrealpath_cache_ttl=600\n' > /usr/local/etc/php/conf.d/opcache.ini

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    GIFTBOOK_DATA_DIR=/var/www/html/data/ \
    GIFTBOOK_CONFIG_DIR=/var/www/html/config/

WORKDIR /var/www/html

# 只拷 www/：网页文件与接口都在里面
COPY www/ /var/www/html/
# 入口脚本放 webroot 之外，整目录挂载也不会被盖掉
COPY entrypoint.sh /usr/local/bin/gift-book-entrypoint
# 旧礼金元数据迁移工具只从 CLI 运行，不放进可被 Web 访问的目录。
RUN mkdir -p /usr/local/lib/gift-book
COPY tools/migrate-private-gifts.php /usr/local/lib/gift-book/migrate-private-gifts.php

# 统一权限：拷贝进来的文件可能是 770 或带 ACL，www-data 会读不到 .htaccess
RUN mkdir -p /var/www/html/data /var/www/html/config \
 && chown -R root:root /var/www/html \
 && chmod -R a+rX /var/www/html \
 && chown -R www-data:www-data /var/www/html/data /var/www/html/config \
 && chmod 775 /var/www/html/data /var/www/html/config \
 && chmod +x /usr/local/bin/gift-book-entrypoint

EXPOSE 80

ENTRYPOINT ["/usr/local/bin/gift-book-entrypoint"]
