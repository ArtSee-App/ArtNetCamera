from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
from PIL import Image
import io
import os
import time

app = Flask(__name__)
CORS(app)

@app.route('/upload', methods=['POST'])
def upload():
    image_data = request.form['image']
    image_data = image_data.split(",")[1]
    
    # Decode the image from base64
    image = Image.open(io.BytesIO(base64.b64decode(image_data)))

    # Specify the directory where images will be saved
    save_path = 'images'
    if not os.path.exists(save_path):
        os.makedirs(save_path)

    # Create a unique filename for the image
    image_filename = 'image_' + str(int(time.time())) + '.png'  # Example: image_1637100247.png

    # Save the image
    image.save(os.path.join(save_path, image_filename))

    return jsonify({"message": "Image received and saved successfully"})

if __name__ == '__main__':
    app.run(debug=True)
