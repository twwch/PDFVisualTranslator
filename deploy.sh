#!/bin/bash

npm run build

cp -r dist hf-deploy

cd hf-deploy

git add .

git commit -m "update"

git push -f