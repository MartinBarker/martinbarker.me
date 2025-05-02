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

# Build the React application & pre-rendering tool
RUN npm run build && npm run postbuild

# Use a multi-stage build to keep the final image small
FROM nginx:alpine

# Install supervisor and Node.js
RUN apk add --no-cache supervisor nodejs npm

# Set the working directory
WORKDIR /app

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy the built application from the previous stage
COPY --from=build /app/build /usr/share/nginx/html

# Copy the source files for the Node server and React app
COPY server.js ./server.js
COPY package*.json ./
COPY src/ ./src/
COPY public/ ./public/

# Copy node_modules from the build stage
COPY --from=build /app/node_modules ./node_modules

# Install production dependencies (this may be optional if all dependencies are already installed in the build stage)
RUN npm install --only=production

# Copy the supervisord configuration
COPY supervisord.conf /etc/supervisord.conf

# Expose ports
EXPOSE 80 3001 3030

# Command to run supervisord
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
