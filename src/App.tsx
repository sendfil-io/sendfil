import React, { useState } from "react"
//import reactLogo from './assets/react.svg'
//import viteLogo from '/vite.svg'
import './App.css'
import WalletModal from './components/WalletModal'

interface Recipient {
  address: string
  amount: string
}

export default function App() {
  const [recipients, setRecipients] = useState<Recipient[]>([
    { address: "", amount: "" },
    { address: "", amount: "" },
    { address: "", amount: "" },
    { address: "", amount: "" },
  ])

  const [isModalOpen, setIsModalOpen] = useState(false)

  const addRecipient = () => {
    setRecipients([...recipients, { address: "", amount: "" }])
  }

  const removeRecipient = (index: number) => {
    setRecipients(recipients.filter((_, i) => i !== index))
  }

  const updateRecipient = (index: number, field: keyof Recipient, value: string) => {
    const newRecipients = [...recipients]
    newRecipients[index] = { ...newRecipients[index], [field]: value }
    setRecipients(newRecipients)
  }

  return (
    <div className="h-screen w-full bg-white flex">
      {/* Sidebar */}
      <div className="w-64 border-r p-6 flex flex-col items-start bg-white">
        <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center mb-4">
          <span className="text-white text-2xl font-bold">ƒ</span>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white rounded-md py-2 mb-4"
        >
          Connect Wallet
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-8 flex flex-col">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold mb-1">SendFIL</h1>
          <p className="text-gray-600 text-sm">Transfer FIL to one or many recipients.</p>
        </div>

        <div className="flex gap-3 mb-8">
          <button className="bg-blue-500 hover:bg-blue-600 text-white rounded-md px-4 py-2">
            Import configuration
          </button>
          <button className="bg-gray-100 text-blue-500 rounded-md px-4 py-2">
            Download Template
          </button>
        </div>

        <div className="grid grid-cols-[1fr,auto] gap-x-4 gap-y-3">
          <div className="font-medium">Receiver</div>
          <div className="font-medium">FIL Amount</div>

          {recipients.map((recipient, index) => (
            <React.Fragment key={index}>
              <div className="relative">
                <input
                  placeholder="f1..."
                  value={recipient.address}
                  onChange={(e) => updateRecipient(index, "address", e.target.value)}
                  className="w-full p-2 border rounded-md bg-gray-100"
                />
              </div>
              <div className="relative flex items-center gap-2">
                <input
                  type="number"
                  placeholder="0"
                  value={recipient.amount}
                  onChange={(e) => updateRecipient(index, "amount", e.target.value)}
                  className="w-full p-2 border rounded-md bg-gray-100"
                />
                {recipients.length > 1 && (
                  <button onClick={() => removeRecipient(index)} className="text-gray-500 hover:text-gray-700 bg-gray-100 rounded-md p-2">
                    ×
                  </button>
                )}
              </div>
            </React.Fragment>
          ))}
        </div>

        <button
          className="mt-4 text-blue-500 hover:text-blue-600 bg-gray-100 rounded-md p-2"
          onClick={addRecipient}
        >
          + Add receiver
        </button>
      </div>

      <WalletModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  )
}
