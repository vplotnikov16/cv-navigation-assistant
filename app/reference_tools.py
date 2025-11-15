from enum import Enum
from pathlib import Path
from typing import List, Dict, Tuple, Any

import numpy as np
import cv2
import ultralytics

from project_settings import get_project_root


_model: ultralytics.YOLO | None = None


def get_translated_class_name(class_name: str) -> str:
    classes = {
        'person': 'человек',
        'bicycle': 'велосипед',
        'car': 'машина',
        'motorcycle': 'мотоцикл',
        'airplane': 'самолёт',
        'bus': 'автобус',
        'train': 'поезд',
        'truck': 'грузовик',
        'boat': 'лодка',
        'traffic light': 'светофор',
        'fire hydrant': 'пожарный гидрант',
        'stop sign': 'знак стоп',
        'parking meter': 'паркомат',
        'bench': 'скамейка',
        'bird': 'птица',
        'cat': 'кот',
        'dog': 'собака',
        'horse': 'лошадь',
        'sheep': 'овца',
        'cow': 'корова',
        'elephant': 'слон',
        'bear': 'медведь',
        'zebra': 'зебра',
        'giraffe': 'жираф',
        'backpack': 'рюкзак',
        'umbrella': 'зонт',
        'handbag': 'сумка',
        'tie': 'галстук',
        'suitcase': 'чемодан',
        'frisbee': 'фрисби',
        'skis': 'лыжи',
        'snowboard': 'сноуборд',
        'sports ball': 'мяч',
        'kite': 'воздушный змей',
        'baseball bat': 'бейсбольная бита',
        'baseball glove': 'бейсбольная перчатка',
        'skateboard': 'скейтборд',
        'surfboard': 'серфборд',
        'tennis racket': 'теннисная ракетка',
        'bottle': 'бутылка',
        'wine glass': 'бокал',
        'cup': 'чашка',
        'fork': 'вилка',
        'knife': 'нож',
        'spoon': 'ложка',
        'bowl': 'миска',
        'banana': 'банан',
        'apple': 'яблоко',
        'sandwich': 'сэндвич',
        'orange': 'апельсин',
        'broccoli': 'брокколи',
        'carrot': 'морковь',
        'hot dog': 'хот-дог',
        'pizza': 'пицца',
        'donut': 'пончик',
        'cake': 'торт',
        'chair': 'стул',
        'couch': 'диван',
        'potted plant': 'растение в горшке',
        'bed': 'кровать',
        'dining table': 'обеденный стол',
        'toilet': 'унитаз',
        'tv': 'телевизор',
        'laptop': 'ноутбук',
        'mouse': 'мышь',
        'remote': 'пульт',
        'keyboard': 'клавиатура',
        'cell phone': 'телефон',
        'microwave': 'микроволновка',
        'oven': 'духовка',
        'toaster': 'тостер',
        'sink': 'раковина',
        'refrigerator': 'холодильник',
        'book': 'книга',
        'clock': 'часы',
        'vase': 'ваза',
        'scissors': 'ножницы',
        'teddy bear': 'плюшевый медведь',
        'hair drier': 'фен',
        'toothbrush': 'зубная щетка'
    }
    return classes.get(class_name, class_name)


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


def get_model(path: str | Path | None = None) -> ultralytics.YOLO:
    global _model
    if _model is not None:
        return _model

    model_path = path or get_project_root() / 'app' / 'yolov8n.pt'
    _model = ultralytics.YOLO(model_path)
    return _model


def bytes_to_cv2_image(image_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def inference(image_bytes: bytes) -> ultralytics.engine.results.Results:
    model = get_model()
    cv2_image = bytes_to_cv2_image(image_bytes)
    detections = model.predict(cv2_image, verbose=False)[0]
    return detections


def get_class_names() -> Dict[int, str]:
    return get_model().names


def get_class_name(class_id: int) -> str:
    return get_class_names()[class_id]


def get_reference_size(class_name: str) -> Tuple[float, float]:
    sizes = {

    }
    return sizes.get(class_name, (1.0, 1.0))


def get_focal_length() -> float:
    return 1000.0


def estimate_distance(class_name: str, bbox_height: float, image_height: int) -> float:
    if class_name in get_class_names().values():
        _, known_height = get_reference_size(class_name)
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
        class_name = get_class_name(class_id)
        confidence = float(conf)

        x1, y1, x2, y2 = map(float, box.cpu().numpy())
        bbox_height = y2 - y1
        distance_m = estimate_distance(class_name, bbox_height, image_height)
        distance_cat, distance_str = get_distance_category(distance_m)

        box_center = ((x1 + x2) / 2, (y1 + y2) / 2)
        horizontal, vertical = calculate_direction(box_center, image_center)

        results.append({
            "object": get_translated_class_name(class_name),
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


def get_objects_from(image_bytes: bytes) -> List[Dict[str, Any]]:
    detections = inference(image_bytes)
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
