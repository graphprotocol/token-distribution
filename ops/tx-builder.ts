import fs from 'fs'
import path from 'path'

export class TxBuilder {
  template: any
  chainId: string
  outputFile: string

  constructor(chainId: string) {
    this.chainId = chainId

    const dateTime = new Date().getTime()
    const templateFilename = path.join(__dirname, 'tx-builder-template.json')
    this.outputFile = path.join(__dirname, `tx-builder-${dateTime}.json`)

    this.template = JSON.parse(fs.readFileSync(templateFilename, 'utf8'))
    this.template.createdAt = dateTime
    this.template.chainId = chainId
  }

  addTx(tx: any) {
    this.template.transactions.push(tx)
  }

  saveToFile() {
    fs.writeFileSync(this.outputFile, JSON.stringify(this.template, null, 2))
    return this.outputFile
  }
}
