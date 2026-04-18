#!/usr/bin/env python3

import os,sys
import json
from typing import Dict,List
import unused_import


def badly_formatted_function(x,y,z):
    """This function has formatting issues"""

    if x>5:
        result=x*y+z
        print("Result: {}".format(result))
    else:
        result = x + y

    return result


class ExampleClass:
    def __init__(self,name,value):
        self.name=name
        self.value =value

    def process_data(self):
        data={'key1':'value1','key2':'value2'}
        return data


if __name__ == "__main__":
    obj=ExampleClass("test",42)
    result=badly_formatted_function(1,2,3)
    print(f"Final result: {result}")