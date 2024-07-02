FROM node:18-alpine as build

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY src/ src/
COPY public/ public/

RUN npm run build

# Use a multi-stage build to keep the final image small
FROM nginx:alpine

# Install supervisor and Node.js
RUN apk add --no-cache supervisor nodejs npm

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy the built application from the previous stage
COPY --from=build /app/build /usr/share/nginx/html

# Copy the source files for the Node server and React app
COPY src/server/server.js /app/src/server/server.js
COPY package*.json /app/
COPY src/ /app/src/
COPY public/ /app/public/

# Copy the supervisord configuration
COPY supervisord.conf /etc/supervisord.conf

# Expose ports
EXPOSE 80 3000 3030

# Command to run supervisord
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
