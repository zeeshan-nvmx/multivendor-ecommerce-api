const express = require('express')
const router = express.Router()
const multer = require('multer')
const upload = multer({ storage: multer.memoryStorage() })
const auth = require('../middleware/auth')
const validateStore = require('../middleware/validateStore')
const { authorizeStore } = require('../middleware/storeAuthorization')
const { getProducts, getProductById, createProduct, updateProduct, deleteProduct, deleteProductImage } = require('../controllers/productController')

// Public store-specific routes
router.get('/', upload.none(), validateStore, getProducts)

router.get('/:id', upload.none(), validateStore, getProductById)

// Protected store-specific routes
router.post('/', auth, upload.array('images'), validateStore, authorizeStore(['store_admin', 'store_manager']), createProduct)

router.put('/:id', auth, upload.array('images'), validateStore, authorizeStore(['store_admin', 'store_manager']), updateProduct)

router.delete('/:id', auth, upload.none(), validateStore, authorizeStore(['store_admin']), deleteProduct)

router.delete('/images/:productId', auth, upload.none(), validateStore, authorizeStore(['store_admin', 'store_manager']), deleteProductImage)

module.exports = router
