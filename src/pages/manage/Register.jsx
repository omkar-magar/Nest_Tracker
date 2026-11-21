import GuestRegister from '../../components/register/GuestRegister'
import { useScope } from '../../components/manage/kit'

// /admin/register: the guest register for the property picked in the header (or a picker when "All properties").
export default function Register() {
  const { property } = useScope()
  return <GuestRegister property={property || undefined} />
}
