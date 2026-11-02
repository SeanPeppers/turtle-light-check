"""Drone Mode helper: video -> 1 frame/sec JPEGs named frame_0000.jpg, frame_0001.jpg ...

    pip install opencv-python-headless
    python tools/extract_frames.py gazebo_flythrough.mp4 frames/

The number in each filename = seconds into the video, which the frontend
matches to the `t` column of poses.csv (t,x,y from Gazebo, in meters).
"""
import os
import sys

import cv2


def main(video, out_dir, fps_out=1.0):
    os.makedirs(out_dir, exist_ok=True)
    cap = cv2.VideoCapture(video)
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30
    step = max(1, round(src_fps / fps_out))
    i = saved = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if i % step == 0:
            t = int(i / src_fps)
            cv2.imwrite(os.path.join(out_dir, f"frame_{t:04d}.jpg"), frame)
            saved += 1
        i += 1
    print(f"saved {saved} frames to {out_dir}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("usage: python tools/extract_frames.py <video> <out_dir>")
    main(sys.argv[1], sys.argv[2])
