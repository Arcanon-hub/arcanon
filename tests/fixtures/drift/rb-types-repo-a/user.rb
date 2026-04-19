class User
  attr_accessor :name, :id

  def initialize(name, id)
    @name = name
    @id = id
  end
end

# This re-opens String - must NOT be captured as a "User type"
String.class_eval do
  def to_custom; "#{self}!"; end
end
