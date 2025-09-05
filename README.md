# Next.js Portfolio - Martin Barker

A modern portfolio website built with Next.js, featuring music applications and professional experience. 

## 🐳 Docker Deployment

### Building and Running

```bash
# Build the Docker image
docker build -t nextjs-portfolio-test .

# Run the container with all necessary ports
docker run -d --name nextjs-test -p 80:80 -p 3001:3001 -p 3030:3030 nextjs-portfolio-test

# Do it all in one line
docker build -t nextjs-portfolio-test . && docker run -d --name nextjs-test -p 80:80 -p 3001:3001 -p 3030:3030 nextjs-portfolio-test
```

### Service Endpoints

- **Main Application**: http://localhost (proxied through nginx)
- **Next.js Direct**: http://localhost:3001
- **Internal API**: http://localhost/internal-api/ (proxied to port 3030)
- **Internal API Direct**: http://localhost:3030

### Container Management

```bash
# View running containers
docker ps

# View container logs
docker logs nextjs-test

# Follow logs in real-time
docker logs -f nextjs-test

# Enter container for debugging
docker exec -it nextjs-test /bin/sh

# View specific service logs
docker exec -it nextjs-test cat /var/log/nginx.log
docker exec -it nextjs-test cat /var/log/node_server.log
docker exec -it nextjs-test cat /var/log/nextjs_app.log
```

### Testing Endpoints

```bash
# Test main application
curl http://localhost

# Test Next.js direct
curl http://localhost:3001

# Test internal API through nginx proxy
curl http://localhost/internal-api/

# Test internal API direct
curl http://localhost:3030
```

### Cleanup

```bash
# Stop the container
docker stop nextjs-test

# Remove the container
docker rm nextjs-test

# Remove the image
docker rmi nextjs-portfolio-test

# Complete cleanup (one command)
docker stop nextjs-test && docker rm nextjs-test && docker rmi nextjs-portfolio-test
```

### Troubleshooting

If you encounter 502 Bad Gateway errors:

1. Check if all services are running:
   ```bash
   docker exec -it nextjs-test ps aux
   ```

2. Check individual service logs:
   ```bash
   docker exec -it nextjs-test cat /var/log/nginx_err.log
   docker exec -it nextjs-test cat /var/log/node_server_err.log
   docker exec -it nextjs-test cat /var/log/nextjs_app_err.log
   ```

3. Verify ports are not conflicting:
   ```bash
   docker exec -it nextjs-test netstat -tlnp
   ```

## 🚀 Local Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run internal server locally
npm run serverLocal
```

## 📁 Project Structure

- `/app` - Next.js application pages and components
- `/public` - Static assets
- `server.js` - Internal API server
- `Dockerfile` - Container configuration
- `nginx.conf` - Nginx proxy configuration
- `supervisord.conf` - Process management

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
