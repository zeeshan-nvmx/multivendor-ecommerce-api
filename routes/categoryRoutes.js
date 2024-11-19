const express = require('express')
const router = express.Router()
const multer = require('multer')
const upload = multer({ storage: multer.memoryStorage() })
const { getCategories, getCategoryById, createCategory, updateCategory, deleteCategory, getSubcategoriesByCategory } = require('../controllers/categoryController')
const auth = require('../middleware/auth')
const validateStore = require('../middleware/validateStore')
const { authorizeStore } = require('../middleware/storeAuthorization')

// Public store-specific routes (no auth required)
router.get('/', upload.none(), validateStore, getCategories)

router.get('/:id', upload.none(), validateStore, getCategoryById)

router.get('/subcategories/:categoryId', upload.none(), validateStore, getSubcategoriesByCategory)

// Protected store-specific routes
router.post('/', auth, upload.single('image'), validateStore, authorizeStore(['store_admin', 'store_manager']), createCategory)

router.put('/:id', auth, upload.single('image'), validateStore, authorizeStore(['store_admin', 'store_manager']), updateCategory)

router.delete('/:id', auth, upload.none(), validateStore, authorizeStore(['store_admin']), deleteCategory)

module.exports = router