const express = require('express')
const router = express.Router()
const multer = require('multer')
const upload = multer({ storage: multer.memoryStorage() })
const auth = require('../middleware/auth')
const validateStore = require('../middleware/validateStore')
const { authorizeStore } = require('../middleware/storeAuthorization')
const { createStore, updateStore, getStores, getStoreById, deleteStore, manageStaffRole, removeStaffRole, getStoreStaff } = require('../controllers/storeController')

// Public routes
router.get('/', getStores)
router.get('/:id', getStoreById)

// Protected routes
router.post(
  '/',
  auth,
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'banner', maxCount: 1 },
  ]),
  createStore
)

router.put(
  '/:id',
  auth,
  validateStore,
  authorizeStore(['store_admin']),
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'banner', maxCount: 1 },
  ]),
  updateStore
)

router.delete('/:id', auth, validateStore, authorizeStore(['store_admin']), deleteStore)

// Staff management routes
router.post('/:id/staff', auth, validateStore, authorizeStore(['store_admin']), manageStaffRole)

router.delete('/:id/staff/:userId', auth, validateStore, authorizeStore(['store_admin']), removeStaffRole)

router.get('/:id/staff', auth, validateStore, authorizeStore(['store_admin', 'store_manager']), getStoreStaff)

module.exports = router
