FROM node:18-alpine as build

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY src/ src/
COPY public/ public/

RUN npm run build

# Use a multi-stage build to keep the final image small
FROM nginx:alpine

# Install supervisor
RUN apk add --no-cache supervisor

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy the built application from the previous stage
COPY --from=build /app/build /usr/share/nginx/html

# Copy the supervisord configuration
COPY supervisord.conf /etc/supervisord.conf

# Expose port 80
EXPOSE 80
# Expose port 30
EXPOSE 80

# Command to run supervisord
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
