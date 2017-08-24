import { Client as MinioClient } from "@streamplace/minio";
import url from "url";
import mpegMungerStream from "./mpeg-munger-stream";

/**
 * Implements the file API described in sp-plugin-core's File.yaml. UUID prefixes are concatenated
 * in ASCII order. This lets us split up mpegts files however we like.
 */
export default function(params) {
  const { accessKeyId, secretAccessKey, host, bucket, prefix } = params;
  const parsed = url.parse(host);
  const secure = parsed.protocol === "https:";
  const mpegMunger = mpegMungerStream();
  let port = parsed.port;
  if (!port) {
    port = secure ? 443 : 80;
  } else {
    port = parseInt(port);
  }
  const minio = new MinioClient({
    endPoint: parsed.hostname,
    accessKey: accessKeyId,
    secretKey: secretAccessKey,
    secure: secure,
    port: port
  });
  let objects;
  // Pipe the next chunk to myself.
  const processNext = () => {
    if (objects.length === 0) {
      return mpegMunger.end();
    }
    const obj = objects.pop();
    minio
      .getObject(bucket, obj.name)
      .then(s3Stream => {
        s3Stream
          .pipe(mpegMunger)
          .on("error", err => {
            throw err;
          })
          .on("end", processNext);
      })
      .catch(err => {
        throw err;
      });
  };
  return new Promise((resolve, reject) => {
    let objects = [];
    minio
      .listObjectsV2(bucket, prefix, true)
      .on("error", err => reject(err))
      .on("data", obj => objects.push(obj))
      .on("end", () => resolve(objects));
  }).then(s3Objects => {
    objects = s3Objects;
    processNext();
    return mpegMunger;
  });
}
