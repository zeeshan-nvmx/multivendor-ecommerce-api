const axios = require('axios')

const getShippingRates = async (shippingAddress) => {
  const { line1, line2, city, state, country, postal_code } = shippingAddress
  const destinationAddress = `${line1}, ${line2}, ${city}, ${state}, ${country}, ${postal_code}`

  const apiUrl = `https://api.royalmail.com/shipping/rates?destinationAddress=${encodeURIComponent(destinationAddress)}`

  try {
    const response = await axios.get(apiUrl, {
      headers: {
        'X-RoyalMail-ApiKey': process.env.ROYAL_MAIL_API_KEY,
      },
    })

    return response.data
  } catch (error) {
    console.error('Error fetching shipping rates:', error)
    throw error
  }
}

const createShippingLabel = async (shippingAddress, totalItems) => {
  const { line1, line2, city, state, country, postal_code } = shippingAddress
  const destinationAddress = `${line1}, ${line2}, ${city}, ${state}, ${country}, ${postal_code}`

  const apiUrl = 'https://api.royalmail.com/shipping/labels'
  const payload = {
    destinationAddress,
    totalItems,
  }

  try {
    const response = await axios.post(apiUrl, payload, {
      headers: {
        'X-RoyalMail-ApiKey': process.env.ROYAL_MAIL_API_KEY,
      },
    })

    return response.data
  } catch (error) {
    console.error('Error creating shipping label:', error)
    throw error
  }
}

module.exports = {
  getShippingRates,
  createShippingLabel,
}
