# F-ComFlow API server
FROM node:20-slim

# Prisma needs OpenSSL
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate && npm run build

EXPOSE 4000
# Apply migrations, then start — safe to run on every boot
CMD ["npm", "run", "start:prod"]
