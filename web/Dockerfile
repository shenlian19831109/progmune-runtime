FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY robots.txt /usr/share/nginx/html/robots.txt
COPY sitemap.xml /usr/share/nginx/html/sitemap.xml
COPY llms.txt /usr/share/nginx/html/llms.txt
COPY privacy.html /usr/share/nginx/html/privacy.html
COPY terms.html /usr/share/nginx/html/terms.html
COPY dd5f26be2e203eb54b285a14d58a862f.txt /usr/share/nginx/html/dd5f26be2e203eb54b285a14d58a862f.txt
COPY assets /usr/share/nginx/html/assets
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
