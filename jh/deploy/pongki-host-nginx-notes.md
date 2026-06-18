# pongki.shop host Nginx hardening notes

Apply these changes on the EC2 host Nginx configuration. Do not commit the
generated Let's Encrypt certificate paths into this repository.

## `/etc/nginx/nginx.conf`

Add this inside the `http { ... }` block:

```nginx
server_tokens off;
```

## `/etc/nginx/sites-available/pongki.shop`

Keep the Certbot-managed SSL directives, and add these inside the HTTPS
`server { ... }` block:

```nginx
client_max_body_size 15m;

add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(self), camera=(), microphone=()" always;

location / {
  proxy_pass http://127.0.0.1:8080;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Then verify and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```
