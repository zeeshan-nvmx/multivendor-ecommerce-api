const jwt = require('jsonwebtoken')

const auth = (req, res, next) => {
  // Safely attempt to access the 'Authorization' header
  const authHeader = req.header('Authorization')
  if (!authHeader) {
    return res.status(401).json({ message: 'No Authorization header provided' })
  }

  // Attempt to extract the token from the header
  let token
  try {
    token = authHeader.replace('Bearer ', '')
  } catch (error) {
    return res.status(401).json({ message: 'Error processing the Authorization header' })
  }

  // Verify the token
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const { id, name, email, role, addresses } = decoded

    req.user = { id, name, email, role, addresses }

    next()
  } catch (err) {
    res.status(406).json({ message: 'Invalid token' })
  }
}

module.exports = auth
