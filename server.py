from tensorflow import keras
import tensorflowjs as tfjs

def importModel(modelPath):
    model = keras.models.load_model(modelPath)
    tfjs.converters.save_keras_model(model, "tfjsmodel")

importModel("./model")
