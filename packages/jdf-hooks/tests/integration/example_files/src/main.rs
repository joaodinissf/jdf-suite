// Badly formatted Rust file with clippy issues
use std::collections::HashMap;

struct User{
name:String,
age:u32,
}

impl User{
fn new(name:String,age:u32)->Self{
User{name,age}
}

fn is_adult(&self)->bool{
self.age>=18
}

fn get_info(&self)->String{
format!("Name: {}, Age: {}",self.name,self.age)
}
}

fn main(){
let mut users=HashMap::new();

// Clippy issue: unnecessary .to_string() on string literal
let user1=User::new("Alice".to_string(),25);
let user2=User::new("Bob".to_string(),17);

users.insert(1,user1);
users.insert(2,user2);

// Clippy issue: unused variable
let _unused_var = 42;

// Clippy issue: manual implementation of Option::map_or
let result = if users.len() > 0 { users.len() } else { 0 };

// Clippy issue: redundant closure
let numbers = vec![1, 2, 3, 4, 5];
let doubled: Vec<i32> = numbers.iter().map(|x| x * 2).collect();

// Clippy issue: single char pattern
let test_string = "hello world";
let parts: Vec<&str> = test_string.split("l").collect();

for(id,user) in &users{
println!("User {}: {}",id,user.get_info());
if user.is_adult(){
println!("This user is an adult");
}else{
println!("This user is a minor");
}
}

// Clippy issue: comparison to empty string
if test_string != "" {
    println!("String is not empty");
}

// Use some variables to avoid unused warnings
println!("Result: {}, Doubled: {:?}, Parts: {:?}", result, doubled, parts);
}