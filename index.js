const prompt = require('prompt')
const puppeteer = require('puppeteer')
const chalk = require('chalk')


const LOGIN_PAGE = 'https://www.retirementlogin.net/rmi401k/default.aspx'
const TRANSACTIONS_PAGE = 'https://www.retirementlogin.net/rmi401k/transhist.aspx?RANDOMNUM=&LINK=51'

const userPassSchema = {
  properties: {
    username: {
      pattern: /^[a-zA-Z\s\-]+$/,
      message: 'Name must be only letters, spaces, or dashes',
      required: true
    },
    password: {
      hidden: true
    }
  }
};


// MAIN LOOP
(async () => {
  console.log(chalk.cyan(asciify('Elevate 401k Retirement Status Scraper', 1)))
  const browserPromise = browserSetup(LOGIN_PAGE)
  let browserFinished = false
  let browser, page
  

  try {

    prompt.start()

    // Keep trying to log in until success
    let loggedIn = false
    while (!loggedIn) {
      try {
        const answers = await getUserCredentials()
        if (!browserFinished) {
          browserResult = await browserPromise
          browser = browserResult.browser
          page = browserResult.page
          browserFinished = true
        }
        await login(page, answers.username, answers.password)
        loggedIn = true
      } catch (e) {
        if (e.message.indexOf('Invalid') !== -1) {
          console.log(chalk.red(e.message + ', please try again'))
        } else {
          throw e
        }
      }
    }
    console.log(chalk.cyan('Logged in!'))


    // Start fetching both balance and transactions
    const balancePromise = getBalance(page)
    const newPage = await browser.newPage()
    newPage.setViewport({ width: 1200, height: 1200})
    const transactionsPromise = getRecentTransactions(newPage, 1)


    // Log out balance
    const balance = await balancePromise
    console.log('Balance is:', chalk.green(balance))

    // Log out transactions
    const transactions = await transactionsPromise
    printTransactions(transactions)

  } catch (e) {
    browser && browser.close()
    throw e
  }
  browser && browser.close()

})().catch(err => {
  // Swallow cancelation errors
  if (err && err.message === 'canceled') return
  console.error(err)
})


// HELPER FUNCTIONS

/**
 * Ask the user for credentials
 * @return {Promise} Promise that resulves with {name, password}
 */
function getUserCredentials() {
  return new Promise(function (resolve, reject) {
    prompt.get(userPassSchema, function (err, result) {
      if (err) return reject(err)
      resolve(result)
    })   
  })
}


/**
 * Sets up the browser and browsers to a url
 * @param  {string} url Initial url to browse to
 * @return {Object}     Object containing { browser, page } Puppeteer objects
 */
async function browserSetup(url) {
  console.log(chalk.grey('Opening browser...'))
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  page.setViewport({ width: 1200, height: 1200})
  await page.goto(LOGIN_PAGE)
  // await page.screenshot({ path: '1-login-page.png' })
  return { browser, page }
}


/**
 * Attempts to log in using the provided credentials
 * @param  {Object} page     Puppeteer page object navigated to the login page
 * @param  {string} username Username to use when logging in
 * @param  {string} password Password to use when logging in
 * @return {void}
 */
async function login(page, username, password) {
  await page.click('#ReliusUserID')
  await page.keyboard.type(username)
  await page.click('#PASSWDTXT')
  await page.keyboard.type(password)
  console.log(chalk.grey('Logging in...'))
  await page.click('#loginpage .submit button')
  await page.waitForNavigation()
  // await page.screenshot({ path: '1.5-post-login-page.png' })
  if (page.url() === LOGIN_PAGE) {
    const loginError = await page.evaluate(() => {
      let errorMessage = document.getElementById('showmessagecommon')
      if (errorMessage && errorMessage.innerText.indexOf('Invalid userid/password') !== -1) {
        return errorMessage.innerText
      }
    })
    if (loginError) {
      throw new Error(loginError)
    }
  }
}


/**
 * Gets the current balance from the overview page
 * @param  {Object} page Logged in Puppeteer page navigated to the overview page
 * @return {string}      String containing the account balance
 */
async function getBalance(page) {
  console.log(chalk.grey('Waiting for balance...'))
  await page.waitForSelector('.balance')
  // await page.screenshot({ path: '2-logged-in.png' })
  const balance = await page.evaluate(() => {
    let balanceElement = document.querySelector('.balance')
    if (balanceElement && balanceElement.innerText) {
      return document.querySelector('.balance').innerText
    }
  })
  return balance
}


/**
 * Fetches recent transactions and their related info
 * @param  {Object} page   Puppeteer page in an authenticated browser
 * @param  {number} months Number of months to query (pagination not supported)
 * @return {Array}         Array of transaction objects using dynamic key/values
 */
async function getRecentTransactions(page, months) {
  console.log(chalk.grey('Opening transactions page...'))
  await page.goto(TRANSACTIONS_PAGE)
  await page.waitForSelector('#tranhistfundform')
  // await page.screenshot({ path: '3-transaction-page.png' })
  const dateRange = await page.evaluate((months) => {
    // Get a date object for the beginning of n months ago
    var lastMonthDate = new Date()
    lastMonthDate.setDate(1)
    lastMonthDate.setMonth(lastMonthDate.getMonth() - months)

    // Use the previous date object to get a date string from the beginning of n months ago
    var lastMonthMonth = lastMonthDate.getMonth() + 1
    var lastMonthYear = lastMonthDate.getFullYear()
    var lastMonthString = lastMonthMonth + '/01/' + lastMonthYear

    // Get a string for today's date
    var nowString = (new Date().getMonth() + 1) + '/' + new Date().getDate() + '/' + new Date().getFullYear()

    // Apply filters and click "get transactions"
    document.querySelector('[name=FILTERDATE]').value = lastMonthString
    document.querySelector('[name=TODATE]').value = nowString
    document.querySelector('#tranhistfundform a.btn').click()

    // Return a string representing the date range selected
    return `Transactions from ${lastMonthString} to ${nowString}`
  }, months)
  console.log(chalk.grey(`Loading ${dateRange}...`))
  await page.waitForNavigation()
  // await page.screenshot({ path: '4-transaction-list.png' })
  const transactions = await page.evaluate(() => {

    // Each transaction is represented by a row, with lots of indistinguishable children
    var rows = document.querySelectorAll('.transaction-history>.collapsable-content')
    var data = []
    for (let i=0; i<rows.length; i++) {

      // Use querySelector to get only the FIRST instance ("account view")
      let header = rows[i].querySelector('thead>tr').querySelectorAll('th')
      let rawData = rows[i].querySelector('tbody>tr').querySelectorAll('td')

      // Build up data for each transaction dynamically based on the columns present on the page
      let rowData = {}
      for (let col=0; col<header.length; col++) {
        let field = header[col].innerText
        let value = rawData[col].innerText
        rowData[field] = value
      }
      data.push(rowData)
    }
    return data
  })
  return transactions
}


/**
 * Print the transaction list in a human readable, colored format
 * @param  {Array} transactions Array of transaction objects
 * @return {void}
 */
function printTransactions(transactions) {
  let longestDollarValue = transactions.reduce((c, i) => Math.max(c, i.Dollars.length), 0)
  console.log('Recent Transactions:')
  transactions.forEach(transaction => {
    let isPositive = transaction.Dollars.charAt(0) !== '('
    let transactionColor = isPositive ? 'green' : 'red'
    let statusColor = transaction.Status === 'Settled' ? 'grey' : 'yellow'
    console.log(
      chalk.grey(`  ${transaction.Date}`) +
      chalk[transactionColor](transaction.Dollars.padStart(longestDollarValue + 1)) + 
      chalk[statusColor](` (${transaction.Status})`) +
      chalk.grey(` ${transaction.Details.replace(' of', '').replace(' to', ' of')}`)
    )
  })
}


/**
 * Duplicates a character a number of times
 * @param  {string} char   Character or string to duplicate
 * @param  {number} length Number of times to duplicate the input string
 * @return {string}        Character duplicated n number of times
 */
function repeat(char, length) {
  let str = ''
  for (let i=0; i<length; i++) {
    str += char
  }
  return str
}


/**
 * Wrap a string in nice, neat rows of asterisks
 * @param  {string} string  Content to asciify
 * @param  {number} padding Multiplier for how much padding to use
 * @return {string}         Multi-line string with padding and a border added
 */
function asciify(string, padding) {
  let horizontalStretch = 5
  let char = '*'
  let border = repeat(char, string.length + padding * horizontalStretch * 2 + 2)
  let gap = char + repeat(' ', string.length + padding * horizontalStretch * 2) + char
  let result = []
  result.push(border)
  for (let i=0; i<padding; i++) {
    result.push(gap)
  }
  result.push(char + repeat(' ', padding * horizontalStretch) + string + repeat(' ', padding * horizontalStretch) + char)
  for (let i=0; i<padding; i++) {
    result.push(gap)
  }
  result.push(border)
  return result.join('\n')
}

