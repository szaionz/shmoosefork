import os
import json
from tqdm import tqdm

COURSE_DATA_DIR = "deploy/courses"
COURSE_NAME_DIR = "deploy/course_names"

def main():
    if not os.path.exists(COURSE_NAME_DIR):
        os.makedirs(COURSE_NAME_DIR)
    course_names = dict()
    for file in tqdm(sorted(os.listdir(COURSE_DATA_DIR))):
        if not "min" in file:
            with open(os.path.join(COURSE_DATA_DIR, file), "r", encoding="utf-8") as f:
                json_str = " = ".join(f.read().split(" = ")[1:])
                course_data = json.loads(json_str)
            for course in course_data:
                course_num = course['general']["מספר מקצוע"]
                if len(course_num)==6:
                    course_num=f"0{course_num[0:3]}0{course_num[3:6]}"
                course_name = course['general']['שם מקצוע']
                course_names[course_num]=course_name
    for course_num, course_name in tqdm(course_names.items()):
        with open(os.path.join(COURSE_NAME_DIR, f"{course_num}.txt"), "w") as f:
            f.write(course_name)
            
if __name__=="__main__":
    main()