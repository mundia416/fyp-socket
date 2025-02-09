const express = require('express');
const app = express();
const http = require('http');
const dotenv = require('dotenv');
const fileUpload = require("express-fileupload");
const faceapiService = require('./faceapiService');
const { matchFace } = require('./faceapiService');
const db = require('./db');
const EntryModel = require('./db-models/EntryModel');
const SettingsModel = require('./db-models/SettingsModel');
const path = require("path");

const { detectFaceMask } = require('./faceMask')

const { getFileData } = require('./utils/fileUtil');
const axios = require('axios');




db.connect()


const MAX_ROLL = 23
const MIN_ROLL = -23
const MAX_PITCH = 17
const MIN_PITCH = -17
const MAX_YAW = 300
const MIN_YAW = -300

const MATCH_MAX_LIMIT = 0.45

app.use(fileUpload());

app.use(express.static('out'))


app.post("/check-banned", async (req, res) => {
  const { file } = req.files;

  const response = await faceapiService.detect(file.data);

  const banned = await isBanned({ result: response.result })

  res.send({ banned, filepath })

})

app.post("/upload", async (req, res) => {
  const { file, existingImage } = req.files;

  const response = await faceapiService.detect(file.data);

  const faceMatch = await matchFace({ existingImage: existingImage.data, result: response.result })

  console.log({ result: response.result })

  const detectedFaces = response.result.length

  if (detectedFaces == 1) {
    res.json({
      detectedFaces,
      faceMatch,
      numberOfLandmarks: response.result[0].landmarks._positions.length,
      numberOfUnshiftedLandmarks: response.result[0].unshiftedLandmarks._positions.length,
      angle: response.result[0].angle
    });
  } else {
    res.json({
      detectedFaces,
      faceMatch
    });
  }
});


app.get("/denied", async (req, res) => {
  io.emit("denied", { denied: true })
  res.send("denied")
});

app.get("/approved", async (req, res) => {
  io.emit("approved", { approved: true })
  res.send("approved")
});

dotenv.config({ path: '../.env' });

const server = http.createServer(app);

const io = require("socket.io")(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }


});


app.post("/facemask", async (req, res) => {
  const { file } = req.files;
  const facemask = await detectFaceMask(file.data)

  res.send(facemask)
})




app.post("/image-upload", async (req, res) => {
  const { file } = req.files;

  try {
    console.log("received stream")

    const response = await faceapiService.detect(file.data);

    if (response) {
      let age, gender

      if (response.result.length === 1) {

        const face = response.result[0]
        age = face.age
        gender = face.gender

        const angle = face.angle

        let approved = true
        if (angle.roll > MAX_ROLL || angle.roll < MIN_ROLL) {
          console.log("wrong roll " + angle.roll)
          approved = false
        }

        if (angle.yaw > MAX_YAW || angle.yaw < MIN_YAW) {
          console.log("wrong yaw " + angle.yaw)
          approved = false
        }

        if (angle.pitch > MAX_PITCH || angle.pitch < MIN_PITCH) {
          console.log("wrong pitch " + angle.pitch)
          approved = false
        }

        const banned = await isBanned({ result: response.result })

        if (banned) {
          approved = false
          io.emit("denied", { denied: true })
        }

        //check if its facemask mode
        const settings = await SettingsModel.findOne({ masterEmail: 'test@gmail.com' })

        if (settings.facemaskMode && approved) {
          console.log("facemask mode enabled")
          age = null
          const faceMaskResponse = await detectFaceMask(file.data)
          console.log({ faceMaskResponse })
          if (faceMaskResponse.withMask < 80) {
            console.log("doesnt have facemask")
            io.emit("denied", { denied: true })
            approved = false
          }
        }

        //todo scan through banned images in database to check for a face match
        if (approved) {
          console.log("approved face")
          console.log("before")
          io.emit("approved", { approved: true })
          const saved = await saveImageFile({ imageFile: file, result: response.result, age, gender })
        }

      }


      io.emit('faceData', {
        detectedFaces: response.result.length,
        age,
        gender
      })

      //send the same data out
      io.emit('showStream', response.image)
      console.log("showStream emitted")
    } else {
      console.log("image null")
    }

  } catch (e) {
    console.log({ e })
  }

  res.send(true)

})



/**
 * io connection
 */

io.on('connection', (socket) => {
  console.log('a user connected');

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
})

const port = process.env.PORT || 4000

server.listen(port, () => {
  console.log('listening socket microservice on port ' + port);
});


const isBanned = async ({ result }) => {
  const bannedEntries = await EntryModel.find({ banned: true });

  console.log({ bannedEntriesCount: bannedEntries.length })

  let isBanned = false

  await Promise.all(
    bannedEntries.map(async (entry) => {
      const existingImageBuffer = await downloadImage(entry.image)
      const faceMatch = await matchFace({ existingImage: existingImageBuffer, result })
      console.log({ faceMatch })
      if (faceMatch && faceMatch._distance <= MATCH_MAX_LIMIT) {
        isBanned = true
      }
    })
  )

  return isBanned
}

const saveImageFile = async ({ imageFile, result, age, gender }) => {
  // first check if the recent entry is of the same user
  const mostRecentEntry = await EntryModel.find().sort({ _id: -1 }).limit(1);


  let faceMatch
  let performSave = false

  if (mostRecentEntry.length > 0) {
    const existingImageBuffer = await downloadImage(mostRecentEntry[0].image)

    faceMatch = await matchFace({ existingImage: existingImageBuffer, result })

  } else {
    //no most recent entries
    performSave = true
  }


  if ((faceMatch && faceMatch._distance <= MATCH_MAX_LIMIT)) {
    //check if the most recent entry is within 20 seconds ago 
    var timestamp = mostRecentEntry[0]._id.toString().substring(0, 8);
    var createdOn = new Date(parseInt(timestamp, 16) * 1000);
    //compare seconds
    const diff = Date.now() - createdOn.getTime()
    const hours = diff / 1000
    const secondsAgo = Math.round(hours)

    console.log({ secondsAgo })

    if (secondsAgo > 20) {
      performSave = true
    } else {
      console.log("face matches most recent entry")
      return false
    }
  } else {
    performSave = true
  }

  if (performSave) {
    const { filepath } = await getFileData(imageFile)

    const model = new EntryModel()
    model.image = filepath
    model.age = age
    model.gender = gender
    // model.temperature = temperature


    await model.save()


    console.log('image saved in db!');
    return true
  } else {
    console.log("dont save")
  }
}

const downloadImage = async (url) => {
  const baseDir = path.resolve(__dirname, "./out");
  console.log({ baseDir })
  const response = await axios({
    url,
    responseType: 'arraybuffer'
  })

  const buffer = Buffer.from(response.data, "utf-8")

  console.log({ buffer })
  return buffer
}