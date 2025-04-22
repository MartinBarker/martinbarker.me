# Local Dev Setup:
- Run `npm i`
- Create `.env` file based off `.env-template` and fill out env vars.
- Run `npm start` and `node server.js` simultaneously.

# How to test docker setup:
- Build docker image and run container:
-  `docker build -t myapp . && docker run -p 80:80 -p 3030:3030 myapp`
- React app should now be at `http://localhost`
- Server should accept requests at `/dbtest` route.

# How to access docker logs:
- Find container ID: `docker ps`
- Open a shell session in the running container `docker exec -it id /bin/sh`
- Navigate to logs folder and print: `cd /var/log && cat node_server.log`

# How to clean up docker:
- Stop container: `docker stop 123abc456def`
- Remove all stopped containers: `docker container prune`
    - Or remove container by id: `docker rm 123abc456def`
- Remove all hanging images: `docker image prune`


# How I created the aws deployment for this project:
Following this guide: https://medium.com/@nwosuonyedikachi/deploying-a-react-app-to-aws-ecs-with-github-actions-5c74c1869800

1. Create, setup, and run react site using npx create-react-app
- npm i
- npm start

2. Create private repo on Elastic Container Registry (ECR) in AWS.
- name: dev-portfolio-react
 
3. Go to Elastic Container Service(ECS) and Create a Cluster
- name: portfolioCluster

4. Create new task definition
- name: DevTaskDefPortfolio
- In 'Container - 1:
    - Enter name "DevContainerPortfolio"
    - For image URI put image name from ECR in step 2 (https://922671116400.dkr.ecr.us-west-1.amazonaws.com/dev-portfolio-react)

5. Create an ECS service for the newly created ECS cluster
- Set name = "DevPortfolioClusterService"
- Select the task we created in previous step 

6. Create GH actions workflow yml
7. Update the `env:` vars in the workflow.yml to contain the real values.
8. Update the github repo secrets to include `` and ``.

# Discogs2YouTube example inputs
- Artist:
    - artist url: https://www.discogs.com/artist/2465614-MontaBrothers
    - artist code: [a2465614]
    - artist id: 2465614
- Label:
    - label url: https://www.discogs.com/label/115620-Yamaha-Music-Foundation
    - label code: [l115620]
    - label id: 115620
- List:
    - list url: https://www.discogs.com/lists/test-list-video-extractor/1601260
    - lsit id: 1601260