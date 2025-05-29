# Specify a base image
FROM node:18-alpine as build

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application files
COPY ./ ./

# Build the Next.js application
RUN npm run build

# Use a multi-stage build to keep the final image small
FROM nginx:alpine

# Install supervisor and Node.js
RUN apk add --no-cache supervisor nodejs npm

# Set the working directory
WORKDIR /app

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy the built Next.js application from the previous stage
COPY --from=build /app/.next/static /usr/share/nginx/html/_next/static
COPY --from=build /app/public /usr/share/nginx/html

# Copy the source files for the Node server and Next.js app
COPY server.js ./server.js
COPY package*.json ./
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules

# Copy the supervisord configuration
COPY supervisord.conf /etc/supervisord.conf

# Expose ports
EXPOSE 80 3001 3030

# Command to run supervisord
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
