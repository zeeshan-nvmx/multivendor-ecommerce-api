const Store = require('../models/Store')

const validateStore = async (req, res, next) => {
  try {

     console.log('Form Data:', req.body)
    const storeId = req.body.storeId || req.params.id
    

    if (!storeId) {
      return res.status(400).json({ message: 'Store ID is required' })
    }

    const store = await Store.findById(storeId)

    if (!store) {
      return res.status(404).json({ message: 'Store not found' })
    }

    if (!store.isActive) {
      return res.status(403).json({ message: 'Store is currently inactive' })
    }

    // Attach store to request object
    req.store = store
    next()
  } catch (error) {
    res.status(500).json({ message: 'Error validating store', error: error.message })
  }
}

module.exports = validateStore
