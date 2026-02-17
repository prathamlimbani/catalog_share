import { MapPin, Phone, Mail, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo_sve.png";

const About = () => {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="bg-gradient-to-br from-primary/10 via-background to-accent py-12 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <img src={logo} alt="Sri Vijayalaxmi Enterprise" className="h-20 sm:h-28 w-auto mx-auto mb-4" />
          <h1 className="text-2xl sm:text-4xl font-bold tracking-tight mb-3">
            About <span className="text-primary">Us</span>
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Your trusted wholesale partner serving quality products at competitive prices.
          </p>
        </div>
      </section>

      {/* Contact Info */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h2 className="text-xl sm:text-2xl font-bold mb-8">Contact Information</h2>
        <div className="grid sm:grid-cols-2 gap-6">
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-primary mt-1 shrink-0" />
              <div>
                <p className="font-semibold">Address</p>
                <p className="text-sm text-muted-foreground">
                  Opposite Indian Oil Pump, Huliyar Road,<br />
                  Hosadurga-577527, Chitradurga Dist,<br />
                  Karnataka
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Phone className="h-5 w-5 text-primary mt-1 shrink-0" />
              <div>
                <p className="font-semibold">Raju V Patel</p>
                <a href="tel:+918431123556" className="text-sm text-primary hover:underline">
                  +91 84311 23556
                </a>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-primary mt-1 shrink-0" />
              <div>
                <p className="font-semibold">Email</p>
                <a href="mailto:svehsd2020@gmail.com" className="text-sm text-primary hover:underline">
                  svehsd2020@gmail.com
                </a>
              </div>
            </div>

            <Button asChild className="mt-4">
              <a
                href="https://maps.app.goo.gl/L5gd3FD3yRADZudg8?g_st=ic"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Google Maps <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </div>

          {/* Map Embed */}
          <div className="rounded-xl overflow-hidden border h-64 sm:h-80">
            <iframe
              title="Sri Vijayalaxmi Enterprise Location"
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3862.0!2d76.39!3d13.79!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2sOpposite+Indian+Oil+Pump%2C+Huliyar+Road%2C+Hosadurga!5e0!3m2!1sen!2sin!4v1700000000000"
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      </section>
    </div>
  );
};

export default About;
