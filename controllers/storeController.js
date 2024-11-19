const Store = require('../models/Store')
const User = require('../models/User')
const { uploadToS3, deleteFromS3 } = require('../utils/s3')
const sharp = require('sharp')
const Joi = require('joi')

// Image processing helper
const processAndUploadImage = async (imageFile, type = 'logo') => {
  try {
    const thumbnailBuffer = await sharp(imageFile.buffer)
      .resize(type === 'logo' ? 200 : 1200, type === 'logo' ? 200 : 400, {
        fit: type === 'logo' ? 'contain' : 'cover',
        withoutEnlargement: true,
      })
      .toBuffer()

    const sanitizedOriginalName = imageFile.originalname.replace(/\s+/g, '')
    const timestamp = Date.now()
    const path = `stores/${type}s`

    const imageUrl = await uploadToS3(imageFile, `${path}/${timestamp}_${sanitizedOriginalName}`)

    return imageUrl
  } catch (error) {
    console.error('Error in processAndUploadImage:', error)
    throw error
  }
}

const createStore = async (req, res) => {
  const schema = Joi.object({
    name: Joi.string().required().min(3).max(50),
    description: Joi.string().optional().max(500),
    address: Joi.object({
      line1: Joi.string().required(),
      line2: Joi.string().optional().allow(''),
      city: Joi.string().required(),
      state: Joi.string().required(),
      country: Joi.string().required(),
      postal_code: Joi.string().required(),
    }),
    contact: Joi.object({
      email: Joi.string().email().required(),
      phone: Joi.string().required(),
    }),
    settings: Joi.object({
      currency: Joi.string().default('USD'),
      taxRate: Joi.number().min(0).max(1).default(0),
      shippingFee: Joi.number().min(0).default(0),
    }).default(),
  })

  const { error } = schema.validate(req.body)
  if (error) {
    return res.status(400).json({
      message: error.details.map((err) => err.message).join(', '),
    })
  }

  try {
    const { name, description, address, contact, settings } = req.body

    // Generate slug from name
    const slug = name
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-') // Replace multiple consecutive hyphens with single hyphen
      .replace(/^-+|-+$/g, '') // Remove leading and trailing hyphens

    // Check if store name exists
    const storeExists = await Store.findOne({
      $or: [{ name: { $regex: new RegExp(`^${name}$`, 'i') } }, { slug }],
    })

    if (storeExists) {
      return res.status(400).json({
        message: 'Store name already exists',
      })
    }

    let logo = ''
    let banner = ''

    if (req.files) {
      const logoFile = req.files.logo?.[0]
      const bannerFile = req.files.banner?.[0]

      if (logoFile) {
        logo = await processAndUploadImage(logoFile, 'logo')
      }
      if (bannerFile) {
        banner = await processAndUploadImage(bannerFile, 'banner')
      }
    }

    console.log(req.user.id)

    const store = await Store.create({
      name,
      slug, // Add the slug here
      description,
      logo,
      banner,
      address,
      contact,
      settings,
      ownerId: req.user.id,
    })

    // Add store_admin role to the creator
    await User.findByIdAndUpdate(req.user.id, {
      $push: {
        storeRoles: {
          storeId: store._id,
          role: 'store_admin',
        },
      },
    })

    res.status(201).json({
      message: 'Store created successfully',
      data: store,
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const updateStore = async (req, res) => {
  const schema = Joi.object({
    name: Joi.string().min(3).max(50),
    description: Joi.string().max(500),
    address: Joi.object({
      line1: Joi.string(),
      line2: Joi.string().allow(''),
      city: Joi.string(),
      state: Joi.string(),
      country: Joi.string(),
      postal_code: Joi.string(),
    }),
    contact: Joi.object({
      email: Joi.string().email(),
      phone: Joi.string(),
    }),
    settings: Joi.object({
      currency: Joi.string(),
      taxRate: Joi.number().min(0).max(1),
      shippingFee: Joi.number().min(0),
    }),
    isActive: Joi.boolean(),
  })

  const { error } = schema.validate(req.body)
  if (error) {
    return res.status(400).json({
      message: error.details.map((err) => err.message).join(', '),
    })
  }

  try {
    const store = await Store.findById(req.params.id)
    if (!store) {
      return res.status(404).json({ message: 'Store not found' })
    }

    const { name, description, address, contact, settings, isActive } = req.body

    if (name && name !== store.name) {
      const nameExists = await Store.findOne({
        name: { $regex: new RegExp(`^${name}$`, 'i') },
        _id: { $ne: store._id },
      })
      if (nameExists) {
        return res.status(400).json({ message: 'Store name already exists' })
      }
      store.name = name
    }

    if (description) store.description = description
    if (address) store.address = { ...store.address, ...address }
    if (contact) store.contact = { ...store.contact, ...contact }
    if (settings) store.settings = { ...store.settings, ...settings }
    if (isActive !== undefined) store.isActive = isActive

    if (req.files) {
      const logoFile = req.files.logo?.[0]
      const bannerFile = req.files.banner?.[0]

      if (logoFile) {
        if (store.logo) {
          await deleteFromS3(store.logo.split('/').pop())
        }
        store.logo = await processAndUploadImage(logoFile, 'logo')
      }

      if (bannerFile) {
        if (store.banner) {
          await deleteFromS3(store.banner.split('/').pop())
        }
        store.banner = await processAndUploadImage(bannerFile, 'banner')
      }
    }

    await store.save()

    res.json({
      message: 'Store updated successfully',
      data: store,
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const getStores = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query
    const query = {}

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { 'address.city': { $regex: search, $options: 'i' } },
        { 'address.state': { $regex: search, $options: 'i' } },
      ]
    }

    // If not admin/superadmin, only show active stores
    if (!['admin', 'superadmin'].includes(req.user?.role)) {
      query.isActive = true
    }

    const totalStores = await Store.countDocuments(query)
    const stores = await Store.find(query)
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 })
      .lean()

    res.json({
      message: 'Stores fetched successfully',
      data: {
        stores,
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalStores / limit),
        totalStores,
      },
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const getStoreById = async (req, res) => {
  try {
    const store = await Store.findById(req.params.id).lean()

    if (!store) {
      return res.status(404).json({ message: 'Store not found' })
    }

    // If not admin/superadmin and store is inactive, deny access
    if (!['admin', 'superadmin'].includes(req.user?.role) && !store.isActive) {
      return res.status(404).json({ message: 'Store not found' })
    }

    res.json({
      message: 'Store fetched successfully',
      data: store,
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const deleteStore = async (req, res) => {
  try {
    const store = await Store.findById(req.params.id)

    if (!store) {
      return res.status(404).json({ message: 'Store not found' })
    }

    // Delete store images
    if (store.logo) {
      await deleteFromS3(store.logo.split('/').pop())
    }
    if (store.banner) {
      await deleteFromS3(store.banner.split('/').pop())
    }

    // Remove store roles from users
    await User.updateMany({ 'storeRoles.storeId': store._id }, { $pull: { storeRoles: { storeId: store._id } } })

    await store.deleteOne()

    res.json({ message: 'Store deleted successfully' })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const manageStaffRole = async (req, res) => {
  const schema = Joi.object({
    userId: Joi.string().required(),
    role: Joi.string().valid('store_admin', 'store_manager', 'store_staff').required(),
  })

  const { error } = schema.validate(req.body)
  if (error) {
    return res.status(400).json({
      message: error.details.map((err) => err.message).join(', '),
    })
  }

  try {
    const { userId, role } = req.body
    const storeId = req.params.id

    const store = await Store.findById(storeId)
    if (!store) {
      return res.status(404).json({ message: 'Store not found' })
    }

    const user = await User.findById(userId)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    // Check if user already has a role in this store
    const existingRoleIndex = user.storeRoles.findIndex((sr) => sr.storeId.toString() === storeId)

    if (existingRoleIndex !== -1) {
      user.storeRoles[existingRoleIndex].role = role
    } else {
      user.storeRoles.push({ storeId, role })
    }

    await user.save()

    res.json({
      message: 'Staff role updated successfully',
      data: user,
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const removeStaffRole = async (req, res) => {
  try {
    const { userId } = req.params
    const storeId = req.params.id

    const user = await User.findById(userId)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    // Remove store role
    user.storeRoles = user.storeRoles.filter((sr) => sr.storeId.toString() !== storeId)

    await user.save()

    res.json({
      message: 'Staff role removed successfully',
      data: user,
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const getStoreStaff = async (req, res) => {
  try {
    const storeId = req.params.id

    const staff = await User.find({ 'storeRoles.storeId': storeId }, { password: 0, otp: 0, otpExpire: 0 })

    res.json({
      message: 'Store staff fetched successfully',
      data: staff,
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

module.exports = {
  createStore,
  updateStore,
  getStores,
  getStoreById,
  deleteStore,
  manageStaffRole,
  removeStaffRole,
  getStoreStaff,
}
