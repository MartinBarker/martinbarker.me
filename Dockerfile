# Build stage
FROM node:18-alpine as build

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY src/ src/
COPY public/ public/

RUN npm run build

# Runtime stage
FROM nginx:alpine

# Install Supervisor
RUN apk add --no-cache supervisor

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built files from build stage
COPY --from=build /app/build /usr/share/nginx/html

# Copy the Node.js server files
COPY src/server /app/server
COPY package*.json /app/

# Install Node.js dependencies for the server
RUN cd /app && npm install

# Copy Supervisor configuration file
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 80

# Start Supervisor, which will start both Nginx and the Node.js server
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
