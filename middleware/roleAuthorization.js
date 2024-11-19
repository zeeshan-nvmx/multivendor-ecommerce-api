const User = require('../models/User')

const authorizeRoles = (...roles) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({ message: 'Authorization required' })
    }

    try {
      const user = await User.findById(req.user.id)

      if (!user) {
        return res.status(404).json({ message: 'User not found' })
      }

      if (roles.includes(user.role)) {
        next()
      } else {
        res.status(403).json({ message: 'Forbidden, insufficient privileges' })
      }
    } catch (error) {
      console.error(error)
      res.status(500).json({ message: 'Internal server error' })
    }
  }
}

module.exports = authorizeRoles
