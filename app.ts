import dotenv from "dotenv-safe"
import express, { Request, Response } from "express"
import freeClimbSdk from "@freeclimb/sdk"
import bodyParser from "body-parser"

//loads environment variables
dotenv.config()
// get the environment variables from the node process
const { ACCOUNT_ID, API_KEY, HOST_URL, PORT } = process.env

// initialize the express object
const app = express()

// apply body-parser middleware
app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())

// define typescript interface that we will use in our routes
// SMS response body
interface SmsBody {
    from: string
    to: string
    text: string
}

// Represention of an instruction that corresponds to user input
interface Instruction {
    script: string
    redirect: string
}

// Format of the instruction store
interface InstructionMap {
    [instructionKey: string]: Instruction
}

//initialize freeClimb sdk (software dev kit) => library/ module
const freeClimbModule = freeClimbSdk(ACCOUNT_ID, API_KEY)

// variable to keep track of user retry counts 
let mainMenuErrorCount = 0

// diagram 


// a route to support sms interaction with FreeClimb
// replies to a text that is sent to our FC number
// not part of the IVR, we will be demoing just to show FC's text functionality
app.post("/incomingSms", async (req: Request<any, any, SmsBody>, res: Response) => {
    const { from, to } = req.body
    await freeClimbModule.api.messages.create(to, from, "Welcome to Seneca-Vail Presentation")
    res.sendStatus(200)
})

// a route that is hit by FC when a call is received 
// and it sends back some instructions, called PerCL (Performance Command Language)
// it's just JSON. When free climb receives that JSON, it will transform those instrcuctions into 
// telephony commands
app.post("/incomingCall", async (req: Request, res: Response) => {
    // Greeting
    const redirectUrl = `${HOST_URL}/mainMenuPrompt`
    const greeting = "Hello welcome to Innocent's bakery."
    const welcomePercl = freeClimbModule.percl.build(
        freeClimbModule.percl.say(greeting),
        freeClimbModule.percl.pause(100),
        freeClimbModule.percl.redirect(redirectUrl)
    )
    res.json(welcomePercl)
})

// this where the call  is redirected to after /incomingCall
// this where digits/input from a user are collected after listing some menuOptions
app.post("/mainMenuPrompt", async (req: Request, res: Response<freeClimbSdk.PerCL.Command[]>) => {
    const actionUrl = `${HOST_URL}/mainMenu`
    const getDigitsPercl = freeClimbModule.percl.getDigits(actionUrl, {
        prompts: [
            freeClimbModule.percl.say("Please listen carefully as our menu options have changed"),
            freeClimbModule.percl.pause(100),
            freeClimbModule.percl.say("For existing cake orders press 1"),
            freeClimbModule.percl.say("For new cake orders press 2"),
            freeClimbModule.percl.say("For hours and locations press 3")
        ],
        maxDigits: 1,
        minDigits: 1,
        initialTimeoutMs: 12000,
        digitTimeoutMs: 6000
    })
    res.json(freeClimbModule.percl.build(getDigitsPercl))
})

// once you have collected digits, this is where we processed the input and act upon it
// this also contains some error handling and retry logic
app.post("/mainMenu", async (req: Request<any, freeClimbSdk.PerCL.Command[], { digits: string }>, res) => {
    const { digits } = req.body
    const instructionMap: InstructionMap = {
        "1": {
            script: "Redirecting your call to existing orders",
            redirect: `${HOST_URL}/transfer`
        },
        "2": {
            script: "Redirecting your call to new orders",
            redirect: `${HOST_URL}/transfer`
        },
        "3": {
            script: `We are open from Monday to Friday from 8am to 5pm 
            on Saturday we are open from 9am to 4pm and we are closed on Sundays`,
            redirect: `${HOST_URL}/endCall`
        },
    }
    const redirectUrl = `${HOST_URL}/mainMenuPrompt`
    const instructions = instructionMap[digits]
    // invalid input and less than error retry limit
    if ((!digits || !instructions) && mainMenuErrorCount < 3 ) {
        mainMenuErrorCount++
        res.json(
            freeClimbModule.percl.build(
                freeClimbModule.percl.say("Error, please try again"),
                freeClimbModule.percl.redirect(redirectUrl)
            )
        )
    } 
    // surpassed error retry limit
    else if (mainMenuErrorCount >= 3) {
        mainMenuErrorCount = 0
        res.json(
            freeClimbModule.percl.build(
                freeClimbModule.percl.say("Maximum retry limit was reached"),
                freeClimbModule.percl.redirect(`${HOST_URL}/endCall`)
            )
        )
    }
    // user provided good input
    else {
        mainMenuErrorCount = 0
        res.json(
            freeClimbModule.percl.build(
                freeClimbModule.percl.say(instructions.script),
                freeClimbModule.percl.redirect(instructions.redirect)
            )
        )
    }
})

// routes that are redirected to depending on user input provided
// in particular this would be where we transfer user to our operator
app.post("/transfer", (req: Request, res: Response) => {
    res.json(
        freeClimbModule.percl.build(
            freeClimbModule.percl.say("Please wait while we transfer you to an operator"),
            freeClimbModule.percl.redirect(`${HOST_URL}/endCall`)
        )
    )
})


// ending/hanging up the call
app.post("/endCall", (req: Request, res: Response) => {
    res.json(
        freeClimbModule.percl.build(
            freeClimbModule.percl.say("Thank you for calling Innocent's bakery, have a nice day"),
            freeClimbModule.percl.hangup()
        )
    )
})


app.listen(PORT, () => {
    console.log(`Succesfully started server on ${PORT}`)
}) 