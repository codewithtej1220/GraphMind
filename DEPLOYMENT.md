# GraphMind Docker Deployment Guide

## Prerequisites

### Install Docker Desktop for Windows

1. Download Docker Desktop from: https://www.docker.com/products/docker-desktop/
2. Run the installer and follow the installation steps
3. Restart your computer if prompted
4. Launch Docker Desktop and wait for it to start
5. Verify installation by opening PowerShell and running:
   ```powershell
   docker --version
   docker-compose --version
   ```

## Deployment Steps

### 1. Navigate to the Project Directory

```powershell
cd c:\Users\bhanu\OneDrive\Documents\graphmind\vizmind
```

### 2. Build and Start the Containers

```powershell
docker-compose up --build
```

This command will:
- Build the backend container (Python + FastAPI)
- Build the frontend container (Next.js)
- Start both containers
- Create a shared network for communication

### 3. Access the Application

Once the containers are running, you can access:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs

### 4. Stop the Containers

To stop the running containers, press `Ctrl+C` in the terminal, then run:

```powershell
docker-compose down
```

## Useful Docker Commands

### Run in Detached Mode (Background)

```powershell
docker-compose up -d
```

### View Running Containers

```powershell
docker ps
```

### View Container Logs

```powershell
# All logs
docker-compose logs

# Backend logs only
docker-compose logs backend

# Frontend logs only
docker-compose logs frontend

# Follow logs in real-time
docker-compose logs -f
```

### Restart Containers

```powershell
docker-compose restart
```

### Rebuild Containers (after code changes)

```powershell
docker-compose up --build
```

### Stop and Remove Everything

```powershell
# Stop containers and remove volumes
docker-compose down -v

# Remove all unused containers, networks, images
docker system prune -a
```

## Container Details

### Backend Container
- **Base Image**: Python 3.14-slim
- **Port**: 8000
- **Includes**: Python, Node.js, TypeScript, Java, GCC/G++, Go, R
- **Memory Limit**: 512MB
- **CPU Limit**: 1.0 cores

### Frontend Container
- **Base Image**: Node.js 24-alpine
- **Port**: 3000
- **Build Type**: Standalone optimized build

## Troubleshooting

### Port Already in Use

If you get "port already in use" errors:

```powershell
# Check what's using port 8000
netstat -ano | findstr :8000

# Check what's using port 3000
netstat -ano | findstr :3000

# Stop the running processes or change ports in docker-compose.yml
```

### Container Won't Start

```powershell
# Check container status
docker-compose ps

# View detailed logs
docker-compose logs

# Rebuild from scratch
docker-compose down -v
docker-compose build --no-cache
docker-compose up
```

### Cannot Connect to Docker

Make sure Docker Desktop is running:
- Look for the Docker icon in your system tray
- If it's not running, launch "Docker Desktop" from Start menu
- Wait for it to show "Docker Desktop is running"

## Production Deployment

For production deployment, consider:

1. **Use Environment Variables**: Create a `.env` file for sensitive data
2. **Enable HTTPS**: Use a reverse proxy like Nginx with SSL certificates
3. **Configure CORS**: Update `FRONTEND_ORIGIN` in docker-compose.yml
4. **Add Health Checks**: Monitor container health
5. **Set Resource Limits**: Adjust memory and CPU limits based on load
6. **Use Docker Volumes**: For persistent data storage
7. **Container Orchestration**: Consider using Kubernetes or Docker Swarm for scaling

## Cloud Deployment Options

### Deploy to AWS
- Use AWS ECS (Elastic Container Service)
- Or AWS App Runner for simpler deployment

### Deploy to Google Cloud
- Use Google Cloud Run
- Or Google Kubernetes Engine (GKE)

### Deploy to Azure
- Use Azure Container Instances
- Or Azure Kubernetes Service (AKS)

### Deploy to Render.com
- Use the existing `render.yaml` configuration
- Connect your GitHub repository
- Render will automatically deploy on push

## Notes

- The backend container includes runtimes for multiple languages (Python, JavaScript, TypeScript, C, C++, Java, Go, R)
- First run may take longer as it downloads Tree-sitter grammars
- Data is persisted in a Docker volume named `graphmind-data`
- Both containers are connected via the `graphmind-network` bridge network
