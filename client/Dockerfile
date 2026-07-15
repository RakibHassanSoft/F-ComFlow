# F-ComFlow dashboard (Next.js)
FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

# NEXT_PUBLIC_* values are baked in at build time
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# One-click Facebook / Ads connect + WhatsApp embedded signup (optional).
# Without these the buttons fall back to manual connect.
ARG NEXT_PUBLIC_META_APP_ID=
ENV NEXT_PUBLIC_META_APP_ID=$NEXT_PUBLIC_META_APP_ID
ARG NEXT_PUBLIC_META_WA_CONFIG_ID=
ENV NEXT_PUBLIC_META_WA_CONFIG_ID=$NEXT_PUBLIC_META_WA_CONFIG_ID
# "Sign in with Google" (optional; button hidden when blank)
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
