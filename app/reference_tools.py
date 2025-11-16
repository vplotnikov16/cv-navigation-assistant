from enum import Enum
from pathlib import Path
from typing import List, Dict, Tuple, Any

import numpy as np
import cv2
import ultralytics

from project_settings import get_project_root


_objects_model: ultralytics.YOLO | None = None
_accessibility_model: ultralytics.YOLO | None = None


CLASS_INFO: Dict[int, Tuple[str, str, Tuple[float, float]]] = {
    0:  ("person", "человек", (0.5, 1.7)),
    1:  ("bicycle", "велосипед", (0.6, 1.1)),
    2:  ("car", "машина", (1.8, 1.5)),
    3:  ("motorcycle", "мотоцикл", (0.8, 1.2)),
    4:  ("airplane", "самолёт", (10.0, 3.0)),
    5:  ("bus", "автобус", (2.5, 3.0)),
    6:  ("train", "поезд", (3.0, 4.0)),
    7:  ("truck", "грузовик", (2.5, 3.5)),
    8:  ("boat", "лодка", (4.0, 1.5)),
    9:  ("traffic light", "светофор", (0.3, 0.8)),
    10: ("fire hydrant", "пожарный гидрант", (0.4, 0.8)),
    11: ("stop sign", "знак стоп", (0.6, 0.6)),
    12: ("parking meter", "паркомат", (0.2, 1.0)),
    13: ("bench", "скамейка", (1.5, 0.9)),
    14: ("bird", "птица", (0.15, 0.25)),
    15: ("cat", "кот", (0.2, 0.3)),
    16: ("dog", "собака", (0.3, 0.5)),
    17: ("horse", "лошадь", (1.5, 2.0)),
    18: ("sheep", "овца", (0.6, 1.0)),
    19: ("cow", "корова", (1.2, 1.5)),
    20: ("elephant", "слон", (2.5, 3.0)),
    21: ("bear", "медведь", (1.0, 1.8)),
    22: ("zebra", "зебра", (1.2, 1.5)),
    23: ("giraffe", "жираф", (1.0, 5.0)),
    24: ("backpack", "рюкзак", (0.3, 0.4)),
    25: ("umbrella", "зонт", (0.8, 1.2)),
    26: ("handbag", "сумка", (0.3, 0.2)),
    27: ("tie", "галстук", (0.1, 0.4)),
    28: ("suitcase", "чемодан", (0.5, 0.3)),
    29: ("frisbee", "фрисби", (0.25, 0.25)),
    30: ("skis", "лыжи", (0.1, 1.8)),
    31: ("snowboard", "сноуборд", (0.3, 1.5)),
    32: ("sports ball", "мяч", (0.22, 0.22)),
    33: ("kite", "воздушный змей", (0.8, 0.8)),
    34: ("baseball bat", "бейсбольная бита", (0.07, 1.0)),
    35: ("baseball glove", "бейсбольная перчатка", (0.3, 0.3)),
    36: ("skateboard", "скейтборд", (0.2, 0.08)),
    37: ("surfboard", "серфборд", (0.6, 0.2)),
    38: ("tennis racket", "теннисная ракетка", (0.3, 0.7)),
    39: ("bottle", "бутылка", (0.08, 0.25)),
    40: ("wine glass", "бокал", (0.08, 0.15)),
    41: ("cup", "чашка", (0.08, 0.1)),
    42: ("fork", "вилка", (0.02, 0.15)),
    43: ("knife", "нож", (0.02, 0.2)),
    44: ("spoon", "ложка", (0.02, 0.15)),
    45: ("bowl", "миска", (0.15, 0.08)),
    46: ("banana", "банан", (0.03, 0.2)),
    47: ("apple", "яблоко", (0.08, 0.08)),
    48: ("sandwich", "сэндвич", (0.15, 0.08)),
    49: ("orange", "апельсин", (0.08, 0.08)),
    50: ("broccoli", "брокколи", (0.15, 0.2)),
    51: ("carrot", "морковь", (0.05, 0.2)),
    52: ("hot dog", "хот-дог", (0.02, 0.15)),
    53: ("pizza", "пицца", (0.3, 0.3)),
    54: ("donut", "пончик", (0.1, 0.1)),
    55: ("cake", "торт", (0.2, 0.1)),
    56: ("chair", "стул", (0.5, 0.8)),
    57: ("couch", "диван", (1.8, 0.9)),
    58: ("potted plant", "растение в горшке", (0.4, 0.6)),
    59: ("bed", "кровать", (2.0, 0.5)),
    60: ("dining table", "стол", (1.5, 0.8)),
    61: ("toilet", "унитаз", (0.4, 0.7)),
    62: ("tv", "телевизор", (1.0, 0.6)),
    63: ("laptop", "ноутбук", (0.3, 0.2)),
    64: ("mouse", "мышь", (0.1, 0.05)),
    65: ("remote", "пульт", (0.15, 0.03)),
    66: ("keyboard", "клавиатура", (0.4, 0.15)),
    67: ("cell phone", "телефон", (0.07, 0.15)),
    68: ("microwave", "микроволновка", (0.5, 0.4)),
    69: ("oven", "духовка", (0.6, 0.6)),
    70: ("toaster", "тостер", (0.3, 0.2)),
    71: ("sink", "раковина", (0.6, 0.4)),
    72: ("refrigerator", "холодильник", (0.8, 1.8)),
    73: ("book", "книга", (0.2, 0.3)),
    74: ("clock", "часы", (0.15, 0.15)),
    75: ("vase", "ваза", (0.2, 0.25)),
    76: ("scissors", "ножницы", (0.15, 0.05)),
    77: ("teddy bear", "плюшевый медведь", (0.3, 0.4)),
    78: ("hair drier", "фен", (0.2, 0.2)),
    79: ("toothbrush", "зубная щетка", (0.02, 0.2)),
    80: ("step", "ступенька", (0.5, 0.15)),
    81: ("stair", "лестница", (1.0, 0.8)),
    82: ("ramp", "пандус", (1.2, 0.15)),
    83: ("grab_bar", "поручень", (0.8, 0.05)),
}


def get_class_info(class_id: int) -> Tuple[str, str, Tuple[float, float]]:
    return CLASS_INFO.get(class_id, ("unknown", "неизвестно", (1.0, 1.0)))


def get_en_class_name(class_id: int) -> str:
    return get_class_info(class_id)[0]


def get_ru_class_name(class_id: int) -> str:
    return get_class_info(class_id)[1]


def get_class_ref_size(class_id: int) -> Tuple[float, float]:
    return get_class_info(class_id)[2]


class DistanceCategory(str, Enum):
    VERY_CLOSE = 'очень близко'
    CLOSE = 'близко'
    FAR = 'далеко'


class Direction(str, Enum):
    LEFT = 'слева'
    RIGHT = 'справа'
    CENTER = 'спереди'
    TOP = 'сверху'
    BOTTOM = 'снизу'


class Models(str, Enum):
    Objects = 'objects_yolo.pt'
    Accessibility = 'accessibility_yolo.pt'


def get_objects_model(path: str | Path | None = None) -> ultralytics.YOLO:
    global _objects_model
    if _objects_model is not None:
        return _objects_model

    model_path = path or get_project_root() / 'app' / Models.Objects.value
    _objects_model = ultralytics.YOLO(model_path)
    return _objects_model


def get_accessibility_model(path: str | Path | None = None) -> ultralytics.YOLO:
    global _accessibility_model
    if _accessibility_model is not None:
        return _accessibility_model

    model_path = path or get_project_root() / 'app' / Models.Accessibility.value
    _accessibility_model = ultralytics.YOLO(model_path)
    return _accessibility_model


def get_model(model: Models = Models.Objects):
    return get_objects_model() if model == Models.Objects else get_accessibility_model()


def bytes_to_cv2_image(image_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def inference(image_bytes: bytes, model_type: Models = Models.Objects) -> ultralytics.engine.results.Results:
    model = get_model(model_type)
    cv2_image = bytes_to_cv2_image(image_bytes)
    detections = model.predict(cv2_image, verbose=False)[0]
    return detections


def get_focal_length() -> float:
    return 1000.0


def estimate_distance(class_id: int, bbox_height: float, image_height: int) -> float:
    if class_id in CLASS_INFO.keys():
        _, known_height = get_class_ref_size(class_id)
        distance = (known_height * get_focal_length()) / bbox_height
        return float(distance)

    ratio = bbox_height / image_height
    if ratio > 0.3:
        return 1.0
    elif ratio > 0.15:
        return 2.5
    elif ratio > 0.05:
        return 5.0
    return 10.0


def get_distance_category(distance: float) -> Tuple[DistanceCategory, str]:
    if distance <= 1.0:
        return DistanceCategory.VERY_CLOSE, f"{distance:.2f} м"
    elif distance <= 3.0:
        return DistanceCategory.CLOSE, f"{distance:.2f} м"
    else:
        return DistanceCategory.FAR, f"{distance:.2f} м"


def calculate_direction(box_center: Tuple[float, float], image_center: Tuple[float, float]) -> Tuple[Direction, Direction]:
    x_diff = (box_center[0] - image_center[0]) / image_center[0]
    y_diff = (box_center[1] - image_center[1]) / image_center[1]

    if x_diff < -0.15:
        horizontal = Direction.LEFT
    elif x_diff > 0.15:
        horizontal = Direction.RIGHT
    else:
        horizontal = Direction.CENTER

    if y_diff < -0.15:
        vertical = Direction.TOP
    elif y_diff > 0.15:
        vertical = Direction.BOTTOM
    else:
        vertical = Direction.CENTER

    return horizontal, vertical


def serialize_detections(detections: Any, image_shape: Tuple[int, int]) -> List[Dict[str, Any]]:
    image_height, image_width = image_shape[:2]
    image_center = (image_width / 2, image_height / 2)

    results = []

    for box, cls_id, conf in zip(detections.boxes.xyxy, detections.boxes.cls, detections.boxes.conf):
        class_id = int(cls_id)
        confidence = float(conf)

        x1, y1, x2, y2 = map(float, box.cpu().numpy())
        bbox_height = y2 - y1
        distance_m = estimate_distance(class_id, bbox_height, image_height)
        distance_cat, distance_str = get_distance_category(distance_m)

        box_center = ((x1 + x2) / 2, (y1 + y2) / 2)
        horizontal, vertical = calculate_direction(box_center, image_center)

        results.append({
            "object": get_ru_class_name(class_id),
            "class_id": class_id,
            "confidence": confidence,
            "distance": {
                "category": distance_cat.value,
                "meters": distance_str,
                "estimated_meters": distance_m
            },
            "direction": {
                "horizontal": horizontal.value,
                "vertical": vertical.value
            },
            "position": {
                "x": box_center[0],
                "y": box_center[1]
            },
            "bbox": {
                "x1": x1, "y1": y1, "x2": x2, "y2": y2
            }
        })
    return results


def print_detections(detections_serialized: List[Dict[str, Any]]):
    for det in detections_serialized:
        obj = det['object']
        conf = det['confidence']
        dist = det['distance']['meters']
        category = det['distance']['category']
        dir_h = det['direction']['horizontal']
        dir_v = det['direction']['vertical']
        pos_x = det['position']['x']
        pos_y = det['position']['y']

        print(f"{obj} | conf: {conf:.2f} | distance: {dist} ({category}) | direction: {dir_h} {dir_v} | position: ({pos_x:.1f}, {pos_y:.1f})")


def get_detections_from(image_bytes: bytes, model_type: Models = Models.Objects) -> List[Dict[str, Any]]:
    detections = inference(image_bytes, model_type)
    cv_image = bytes_to_cv2_image(image_bytes)
    serialized = serialize_detections(detections, cv_image.shape)
    return serialized


if __name__ == '__main__':
    with open(get_project_root() / 'image.jpeg', 'rb') as file:
        image_bytes = file.read()
    detections = inference(image_bytes)
    cv_image = bytes_to_cv2_image(image_bytes)
    serialized = serialize_detections(detections, cv_image.shape)
    print(serialized[0])
