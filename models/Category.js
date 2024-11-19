const mongoose = require('mongoose')
const { Schema } = mongoose

const categorySchema = new Schema({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
  },
  image: {
    type: String,
  },
  thumbnail: {
    type: String,
  },
  isSubcategory: {
    type: Boolean,
    default: false,
  },
  parentCategory: {
    type: Schema.Types.ObjectId,
    ref: 'Category',
    default: null,
  },
  storeId: {
    type: Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
  },
})

// Compound index for unique category names within a store
categorySchema.index({ name: 1, storeId: 1 }, { unique: true })

const Category = mongoose.model('Category', categorySchema)
module.exports = Category
