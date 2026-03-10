// Badly formatted Java file
import java.util.*;
import java.io.*;

public class Example{
private String name;
private int age;

public Example(String name,int age){
this.name=name;
this.age=age;
}

public void processData(){
List<String> items=new ArrayList<>();
items.add("item1");
items.add("item2");
items.add("item3");

for(String item:items){
System.out.println("Processing: "+item);
}

Map<String,Integer> data=new HashMap<>();
data.put("key1",1);
data.put("key2",2);

if(age>18){
System.out.println("Adult user: "+name);
}else{
System.out.println("Minor user: "+name);
}
}

public static void main(String[]args){
Example example=new Example("John",25);
example.processData();
}
}