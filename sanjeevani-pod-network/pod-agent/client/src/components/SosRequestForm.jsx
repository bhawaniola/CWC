import { useState } from "react";
import { REQUEST_CATEGORIES } from "../constants/requestCategories.js";

const INITIAL_FORM_STATE = {
  name: "Ramesh Kumar",
  age: "68",
  phone: "+91 9876543210",
  category: "Medical",
  location: "Kothapalli Zone 3",
  message: "My grandfather needs insulin and cannot walk"
};

export function SosRequestForm({ isSubmitting, onSubmit }) {
  const [formData, setFormData] = useState(INITIAL_FORM_STATE);

  function updateField(event) {
    const { name, value } = event.target;
    setFormData((current) => ({
      ...current,
      [name]: value
    }));
  }

  function submitForm(event) {
    event.preventDefault();
    onSubmit({
      ...formData,
      age: formData.age ? Number(formData.age) : null
    });
  }

  return (
    <form className="request-form" onSubmit={submitForm}>
      <label>
        Your name
        <input name="name" type="text" value={formData.name} onChange={updateField} autoComplete="name" required />
      </label>
      <label>
        Age
        <input name="age" type="number" min="0" value={formData.age} onChange={updateField} inputMode="numeric" />
      </label>
      <label>
        Phone
        <input name="phone" type="tel" value={formData.phone} onChange={updateField} autoComplete="tel" />
      </label>
      <label>
        Need type
        <select name="category" value={formData.category} onChange={updateField}>
          {REQUEST_CATEGORIES.map((category) => (
            <option key={category}>{category}</option>
          ))}
        </select>
      </label>
      <label className="full">
        Location
        <input
          name="location"
          type="text"
          value={formData.location}
          onChange={updateField}
          autoComplete="street-address"
          required
        />
      </label>
      <label className="full">
        SOS message
        <textarea name="message" rows="6" value={formData.message} onChange={updateField} required />
      </label>
      <button className="primary" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Sending SOS..." : "Send SOS Request"}
      </button>
    </form>
  );
}
