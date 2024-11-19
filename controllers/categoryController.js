const Category = require('../models/Category')
// const Product = require('../models/Product')
const { uploadToS3, deleteFromS3 } = require('../utils/s3')
const Joi = require('joi')
const sharp = require('sharp')
const { ObjectId, isValidObjectId } = require('mongoose').Types

// Image processing helper function remains the same
const processAndUploadImage = async (imageFile, pathPrefix = 'categories') => {
  try {
    const thumbnailBuffer = await sharp(imageFile.buffer)
      .resize(400, 400, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toBuffer()

    const sanitizedOriginalName = imageFile.originalname.replace(/\s+/g, '')
    const timestamp = Date.now()

    const image = await uploadToS3(imageFile, `${pathPrefix}/${timestamp}_${sanitizedOriginalName}`)
    const thumbnail = await uploadToS3({ ...imageFile, buffer: thumbnailBuffer }, `${pathPrefix}/thumbnails/${timestamp}_thumb_${sanitizedOriginalName}`)

    return {
      image,
      thumbnail,
    }
  } catch (error) {
    console.error('Error in processAndUploadImage:', error)
    throw error
  }
}

const getCategories = async (req, res) => {
  try {
    // Use store from middleware
    const storeId = req.store._id

    const categories = await Category.find({ storeId }).lean()

    const formattedCategories = categories.map((category) => {
      const formattedCategory = {
        ...category,
        subcategories: [],
      }

      if (!category.isSubcategory) {
        const subcategories = categories.filter(
          (c) => c.parentCategory && c.parentCategory.toString() === category._id.toString() && c.storeId.toString() === storeId.toString()
        )
        formattedCategory.subcategories = subcategories.map((subcategory) => ({
          id: subcategory._id,
          name: subcategory.name,
        }))
      }

      return formattedCategory
    })

    res.status(200).json({
      message: 'Categories fetched successfully',
      data: formattedCategories,
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const getCategoryById = async (req, res) => {
  try {
    const storeId = req.store._id
    const category = await Category.findOne({
      _id: req.params.id,
      storeId,
    }).lean()

    if (!category) {
      return res.status(404).json({ message: 'Category not found' })
    }

    const formattedCategory = {
      ...category,
      subcategories: [],
    }

    if (!category.isSubcategory) {
      const subcategories = await Category.find({
        parentCategory: category._id,
        storeId,
      })
        .select('name _id')
        .lean()

      formattedCategory.subcategories = subcategories.map((subcategory) => ({
        id: subcategory._id,
        name: subcategory.name,
      }))
    }

    res.status(200).json({
      message: 'Category fetched successfully',
      data: formattedCategory,
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const createCategory = async (req, res) => {
  const schema = Joi.object({
    name: Joi.string().trim().min(3).max(50).required(),
    description: Joi.string().trim().min(3).max(500),
    isSubcategory: Joi.boolean(),
    parentCategoryId: Joi.string().trim().length(24).when('isSubcategory', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.forbidden(),
    }),
    storeId: Joi.string().required()
  })

  const { error } = schema.validate(req.body)
  if (error) {
    return res.status(400).json({ message: error.details[0].message })
  }

  const { name, description, isSubcategory, parentCategoryId } = req.body
  const storeId = req.store._id

  try {
    // Check if category name already exists in this store
    const categoryExists = await Category.findOne({
      name,
      storeId,
    })

    if (categoryExists) {
      return res.status(400).json({ message: 'Category already exists in this store' })
    }

    // If it's a subcategory, verify parent category belongs to same store
    if (isSubcategory && parentCategoryId) {
      const parentCategory = await Category.findOne({
        _id: parentCategoryId,
        storeId,
      })

      if (!parentCategory) {
        return res.status(400).json({
          message: 'Parent category not found in this store',
        })
      }
    }

    let image = ''
    let thumbnail = ''

    if (req.file) {
      try {
        const result = await processAndUploadImage(req.file)
        image = result.image
        thumbnail = result.thumbnail
      } catch (error) {
        console.error('Error processing image:', error)
        return res.status(500).json({
          message: 'Error processing image',
          error: error.message,
        })
      }
    }

    const category = await Category.create({
      name,
      description,
      image,
      thumbnail,
      isSubcategory: isSubcategory || false,
      parentCategory: isSubcategory ? parentCategoryId : null,
      storeId,
    })

    res.status(201).json({
      message: 'Category created successfully',
      data: category,
    })
  } catch (error) {
    console.error('Error in createCategory:', error)
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const updateCategory = async (req, res) => {
  const schema = Joi.object({
    name: Joi.string().trim().min(3).max(50),
    description: Joi.string().trim().min(3).max(500),
    isSubcategory: Joi.boolean(),
    parentCategoryId: Joi.string().trim().length(24).when('isSubcategory', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.forbidden(),
    }),
    storeId: Joi.string().required()
  })

  const { error } = schema.validate(req.body)
  if (error) {
    return res.status(400).json({ message: error.details[0].message })
  }

  const { name, description, isSubcategory, parentCategoryId } = req.body
  const storeId = req.store._id

  try {
    const category = await Category.findOne({
      _id: req.params.id,
      storeId,
    })

    if (!category) {
      return res.status(404).json({ message: 'Category not found in this store' })
    }

    // If updating name, check for uniqueness in store
    if (name && name !== category.name) {
      const nameExists = await Category.findOne({
        name,
        storeId,
        _id: { $ne: category._id },
      })

      if (nameExists) {
        return res.status(400).json({
          message: 'Category name already exists in this store',
        })
      }
      category.name = name
    }

    if (description) category.description = description
    if (isSubcategory !== undefined) category.isSubcategory = isSubcategory

    if (isSubcategory && parentCategoryId) {
      const parentCategory = await Category.findOne({
        _id: parentCategoryId,
        storeId,
      })

      if (!parentCategory) {
        return res.status(400).json({
          message: 'Parent category not found in this store',
        })
      }
      category.parentCategory = parentCategoryId
    }

    if (req.file) {
      try {
        // Delete existing images
        if (category.image) {
          await deleteFromS3(category.image.split('/').pop())
        }
        if (category.thumbnail) {
          await deleteFromS3(category.thumbnail.split('/').pop())
        }

        // Process and upload new image
        const result = await processAndUploadImage(req.file)
        category.image = result.image
        category.thumbnail = result.thumbnail
      } catch (error) {
        console.error('Error processing image:', error)
        return res.status(500).json({
          message: 'Error processing image',
          error: error.message,
        })
      }
    }

    const updatedCategory = await category.save()
    res.json(updatedCategory)
  } catch (error) {
    console.error('Error in updateCategory:', error)
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const deleteCategory = async (req, res) => {
  try {
    const storeId = req.store._id
    const category = await Category.findOne({
      _id: req.params.id,
      storeId,
    })

    if (!category) {
      return res.status(404).json({ message: 'Category not found in this store' })
    }

    // Delete images from S3
    if (category.image) {
      try {
        await deleteFromS3(category.image.split('/').pop())
      } catch (error) {
        console.error('Error deleting category image from S3:', error)
      }
    }
    if (category.thumbnail) {
      try {
        await deleteFromS3(category.thumbnail.split('/').pop())
      } catch (error) {
        console.error('Error deleting category thumbnail from S3:', error)
      }
    }

   // Find all products in this store associated with this category
    // const productsToDelete = await Product.find({
    //   categories: category._id,
    //   storeId,
    // })

    // // Delete associated products
    // for (const product of productsToDelete) {
    //   // Delete product images from S3
    //   for (const image of product.images) {
    //     try {
    //       await deleteFromS3(image.original?.split('/').pop())
    //       await deleteFromS3(image.thumbnail?.split('/').pop())
    //     } catch (error) {
    //       console.error('Error deleting product image from S3:', error)
    //     }
    //   }

    //   await Product.deleteOne({ _id: product._id })
    // }

    // Delete the category
    await Category.deleteOne({ _id: category._id })

    res.json({ message: 'Category was deleted successfully' })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const getSubcategoriesByCategory = async (req, res) => {
  try {
    const storeId = req.store._id
    const categoryId = req.params.categoryId

    const subcategories = await Category.find({
      parentCategory: categoryId,
      storeId,
    })

    res.status(200).json({
      message: 'Subcategories fetched successfully',
      data: subcategories,
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

module.exports = {
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  getSubcategoriesByCategory,
}
