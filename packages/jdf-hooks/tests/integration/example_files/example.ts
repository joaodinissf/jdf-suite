interface User{
name:string;
age:number;
email?:string;
}

class UserManager{
private users:User[]=[];

addUser(user:User):void{
this.users.push(user);
}

getAdultUsers():User[]{
return this.users.filter(user=>user.age>=18);
}

getUserByName(name:string):User|undefined{
return this.users.find(user=>user.name===name);
}
}

const manager=new UserManager();
manager.addUser({name:"Alice",age:25,email:"alice@example.com"});
manager.addUser({name:"Bob",age:17});

console.log("Adult users:",manager.getAdultUsers());