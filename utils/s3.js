const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')

const s3 = new S3Client({
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
})

const uploadToS3 = async (file, key) => {
  console.log('Starting upload with params:', {
    bucket: process.env.R2_BUCKET_NAME,
    key,
    contentType: file.mimetype,
  })

  try {
    
    const uploadParams = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    }

    const result = await s3.send(new PutObjectCommand(uploadParams))
    console.log('Upload result:', result)

    // Construct the public URL using the R2 public domain
    const publicUrl = `https://${process.env.R2_PUBLIC_DOMAIN}/${key}`
    console.log('Generated public URL:', publicUrl)

    return publicUrl
  } catch (err) {
    console.error('R2 Upload Error Details:', {
      error: err.message,
      code: err.Code,
      requestId: err.$metadata?.requestId,
      statusCode: err.$metadata?.httpStatusCode,
      bucket: process.env.R2_BUCKET_NAME,
      key,
      credentials: {
        accessKeyIdPresent: !!process.env.R2_ACCESS_KEY_ID,
        secretKeyPresent: !!process.env.R2_SECRET_ACCESS_KEY,
        accountIdPresent: !!process.env.R2_ACCOUNT_ID,
      },
    })
    throw err
  }
}

const deleteFromS3 = async (key) => {
  try {
    const deleteParams = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    }

    await s3.send(new DeleteObjectCommand(deleteParams))
    console.log('Successfully deleted:', key)
  } catch (err) {
    console.error('Delete error:', err)
    throw err
  }
}

// Add this function to test connectivity
const testR2Connection = async () => {
  try {
    const testKey = `test-${Date.now()}.txt`
    const testParams = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: testKey,
      Body: 'test connection',
      ContentType: 'text/plain',
      CacheControl: 'no-cache',
      Metadata: {
        'public-access': 'true',
      },
    }

    await s3.send(new PutObjectCommand(testParams))
    console.log('Test upload successful')

    // Clean up test file
    await deleteFromS3(testKey)
    return true
  } catch (error) {
    console.error('Connection test failed:', error)
    return false
  }
}

module.exports = {
  uploadToS3,
  deleteFromS3,
  testR2Connection,
}
