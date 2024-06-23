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