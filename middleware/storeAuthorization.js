const User = require('../models/User')

const authorizeStore = (requiredRoles) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Authentication required' })
      }

      if (!req.store) {
        return res.status(400).json({ message: 'Store context is required' })
      }

      // Superadmin can access everything
      if (req.user.role === 'superadmin') {
        return next()
      }

      // Global admin can access everything except specific store settings
      if (req.user.role === 'admin') {
        return next()
      }

      const user = await User.findById(req.user.id)
      if (!user) {
        return res.status(404).json({ message: 'User not found' })
      }

      // Check if user has required role for this specific store
      const hasRequiredRole = user.storeRoles.some(
        (storeRole) =>
          storeRole.storeId.toString() === req.store._id.toString() &&
          (Array.isArray(requiredRoles) ? requiredRoles.includes(storeRole.role) : storeRole.role === requiredRoles)
      )

      if (!hasRequiredRole) {
        return res.status(403).json({
          message: 'You do not have the required permissions for this store',
        })
      }

      // Attach store role to request for further use
      req.storeRole = user.storeRoles.find((sr) => sr.storeId.toString() === req.store._id.toString())?.role

      next()
    } catch (error) {
      res.status(500).json({
        message: 'Error checking store authorization',
        error: error.message,
      })
    }
  }
}

// Helper middleware to ensure user is either store staff or the customer themselves
const authorizeStoreOrSelf = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' })
    }

    if (!req.store) {
      return res.status(400).json({ message: 'Store context is required' })
    }

    // Superadmin and admin can access
    if (['superadmin', 'admin'].includes(req.user.role)) {
      return next()
    }

    const user = await User.findById(req.user.id)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    // Check if user is store staff
    const isStoreStaff = user.storeRoles.some((storeRole) => storeRole.storeId.toString() === req.store._id.toString())

    // Check if user is accessing their own data
    const isSelfAccess = req.params.userId === req.user.id

    if (!isStoreStaff && !isSelfAccess) {
      return res.status(403).json({
        message: 'You do not have permission to access this resource',
      })
    }

    next()
  } catch (error) {
    res.status(500).json({
      message: 'Error checking authorization',
      error: error.message,
    })
  }
}

module.exports = {
  authorizeStore,
  authorizeStoreOrSelf,
}
