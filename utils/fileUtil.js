const AWS = require('aws-sdk');
const axios = require('axios');
const fs = require('fs');

const s3 = new AWS.S3({
    accessKeyId: "; AKIAYFRZYUGMI7C4NA72",
    secretAccessKey: "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"
});
/**
 * get the data of a file as a string in utf8 format
 */
const getFileData = async (file) => {
    // let filedata
    const filename = Date.now().toString()
    // const response = await file;

    // if (response && response.createReadStream) {

    //     function streamToString() {
    //         const stream = response.createReadStream()
    //         const chunks = [];
    //         return new Promise((resolve, reject) => {
    //             stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    //             stream.on('error', (err) => reject(err));
    //             stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    //         })
    //     }

    //     filedata = await streamToString()

    //     // console.log({ filedata }, "check here")
    // } else {
    //     if (response !== null) {
    //         filedata = file
    //     }
    // }
    // console.log( "check file")
    // [TODO: refactor] refeactor and include a catch for error
    const { Location } = await pushToS3(file, filename);

    return { filepath: Location }
}


const pushToS3 = async (data, filename) => {

    // const buf = Buffer.from(
    //     data.data.replace(/^data:image\/\w+;base64,/, ""),
    //     "base64"
    // );
    const params = {
        Key: `${filename}.jpeg`,
        Body: data.data,
        ContentEncoding: data.encoding,
        ContentType: data.mimetype,
        Bucket: 'fyp-kennedy',
    };
    const response = await s3.upload(params).promise();
    // console.log(response, "check response in callback")
    return response;
};




module.exports = {
    getFileData,
}