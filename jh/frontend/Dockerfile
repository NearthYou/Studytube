FROM node:24-bookworm-slim AS build

WORKDIR /app

ARG VITE_API_BASE_URL=
ARG VITE_KAKAO_MAP_JS_KEY=
ARG VITE_ENABLED_SOCIAL_PROVIDERS=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_KAKAO_MAP_JS_KEY=${VITE_KAKAO_MAP_JS_KEY}
ENV VITE_ENABLED_SOCIAL_PROVIDERS=${VITE_ENABLED_SOCIAL_PROVIDERS}

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.29-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
