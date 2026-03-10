#!/bin/bash

# Badly formatted shell script
function setup_environment(){
export NODE_ENV=production
export DATABASE_URL=postgresql://localhost:5432/mydb
export API_KEY=secret123
}

setup_environment

if [ "$NODE_ENV" == "production" ];then
echo "Running in production mode"
npm run build
npm start
else
echo "Running in development mode"
npm run dev
fi

for file in *.txt;do
if [ -f "$file" ];then
echo "Processing $file"
cat "$file"|grep "error"|wc -l
fi
done

users=("alice" "bob" "charlie")
for user in "${users[@]}";do
echo "Creating user: $user"
useradd "$user"
done