// Badly formatted JavaScript file
const data={name:"John",age:30,city:"New York"};

function processUser(user){
if(user.age>18){
console.log("Adult user: "+user.name);
return true;
}else{
console.log("Minor user: "+user.name);
return false;
}
}

const users=[
{name:"Alice",age:25},
{name:"Bob",age:17},
{name:"Charlie",age:30}
];

users.forEach(user=>{
const result=processUser(user);
console.log(`Result for ${user.name}: ${result}`);
});